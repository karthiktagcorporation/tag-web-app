import { createServerFn } from "@tanstack/react-start";

const SYSTEM_PROMPT = `You are an expert engineering drawing parser.

Your task is to extract ONLY the BILL OF MATERIAL (BOM) / PARTS LIST table from the given drawing.

STRICT RULES FOR LOCATION DETECTION:

FIRST identify the BOM table:
- It is usually a grid/table with columns like: ITEM / SL NO / PART NO / DESCRIPTION / QTY
- Located typically: Bottom right, Bottom center, Sometimes top right
- Ignore title block, notes, and dimension areas

DO NOT extract from:
- Title block (drawing number like TAG/E/ST/S1/088)
- General notes
- Revision tables
- Balloon callouts without table mapping

TABLE STRUCTURE EXPECTATION:
Extract row-wise with these fields:
- Sl No
- Item Code (or Part Number) — pattern: letter + 7-9 digits (e.g. G00211094)
- Drawing Number (if present)
- Description / Name
- Quantity (integer, from QTY column only — NOT from UTS/dimension columns)

EXTRACTION RULES:
- Maintain row integrity (do not mix columns)
- Quantity must come only from QTY column (not dimensions, not UTS)
- If any field is unclear → mark as "NOT_READABLE"
- If a row exists partially → still include it

VALIDATION BEFORE OUTPUT:
- Ensure all rows belong to SAME table
- Ensure quantities are numeric and aligned with rows
- Ensure no title block data is included

Also identify the TOP-LEVEL ASSEMBLY of THIS page from the title block:
- top_item_code: the page's main ITEM CODE (letter + 7-9 digits)
- top_drawing_no: the page's main DRG.NO

Accuracy is more important than completeness. Do NOT guess.`;

const extractTool = {
  type: "function" as const,
  function: {
    name: "return_bom_table",
    description:
      "Return the BOM table extracted from a single drawing page, plus the page's top-level assembly identifiers from the title block.",
    parameters: {
      type: "object",
      properties: {
        bom_table_found: {
          type: "boolean",
          description: "true if a BOM table is clearly identified on this page",
        },
        top_item_code: {
          type: "string",
          description:
            "The page's main assembly ITEM CODE from the title block (letter + 7-9 digits). Empty string if not present.",
        },
        top_drawing_no: {
          type: "string",
          description:
            "The page's main DRG.NO from the title block. Empty string if not present.",
        },
        components: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sl_no: { type: "string" },
              item_code: {
                type: "string",
                description:
                  "Item code (letter + 7-9 digits) or 'NOT_READABLE'",
              },
              drawing_no: {
                type: "string",
                description: "Drawing number, or empty string if missing",
              },
              description: { type: "string" },
              qty: {
                type: "string",
                description:
                  "Quantity as a string integer from the QTY column only, or 'NOT_READABLE'",
              },
            },
            required: [
              "sl_no",
              "item_code",
              "drawing_no",
              "description",
              "qty",
            ],
            additionalProperties: false,
          },
        },
      },
      required: [
        "bom_table_found",
        "top_item_code",
        "top_drawing_no",
        "components",
      ],
      additionalProperties: false,
    },
  },
};

export interface AiBomComponent {
  sl_no: string;
  item_code: string;
  drawing_no: string;
  description: string;
  qty: string;
}

export interface AiPageResult {
  bom_table_found: boolean;
  top_item_code: string;
  top_drawing_no: string;
  components: AiBomComponent[];
}

// ---------- Region locator (used to crop BOM table area on page 1) ----------

const LOCATE_SYSTEM_PROMPT = `You are an expert at locating tables in engineering drawings.
Given a full drawing page image, return the bounding box of the BILL OF MATERIAL (BOM) / PARTS LIST table only.
The BOM table is a grid with columns like ITEM / SL NO / PART NO / DESCRIPTION / QTY,
typically in the bottom-right, bottom-center, or top-right of the sheet.
Do NOT return the title block, notes, or revision table.
Return coordinates as fractions of the image (0.0 to 1.0), where (0,0) is top-left.
Include a small margin (~2%) around the table so column headers and the last row are not clipped.`;

const locateTool = {
  type: "function" as const,
  function: {
    name: "return_bom_region",
    description: "Return normalized bounding box of the BOM table on the page.",
    parameters: {
      type: "object",
      properties: {
        found: { type: "boolean" },
        x: { type: "number", description: "Left edge, 0..1" },
        y: { type: "number", description: "Top edge, 0..1" },
        w: { type: "number", description: "Width, 0..1" },
        h: { type: "number", description: "Height, 0..1" },
      },
      required: ["found", "x", "y", "w", "h"],
      additionalProperties: false,
    },
  },
};

export interface AiRegion {
  found: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const locateBomRegion = createServerFn({ method: "POST" })
  .inputValidator((input: { imageDataUrl: string }) => {
    if (!input || typeof input.imageDataUrl !== "string") {
      throw new Error("imageDataUrl is required");
    }
    if (!input.imageDataUrl.startsWith("data:image/")) {
      throw new Error("imageDataUrl must be a data: URL");
    }
    return input;
  })
  .handler(async ({ data }): Promise<AiRegion> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: LOCATE_SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Locate the BOM / PARTS LIST table and return its normalized bounding box via the return_bom_region tool.",
                },
                { type: "image_url", image_url: { url: data.imageDataUrl } },
              ],
            },
          ],
          tools: [locateTool],
          tool_choice: {
            type: "function",
            function: { name: "return_bom_region" },
          },
        }),
      },
    );

    if (!response.ok) {
      return { found: false, x: 0, y: 0, w: 1, h: 1 };
    }
    const json = await response.json();
    const argsStr =
      json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argsStr) return { found: false, x: 0, y: 0, w: 1, h: 1 };
    try {
      const p = JSON.parse(argsStr) as AiRegion;
      const clamp = (v: number) => Math.max(0, Math.min(1, Number(v) || 0));
      return {
        found: !!p.found,
        x: clamp(p.x),
        y: clamp(p.y),
        w: clamp(p.w),
        h: clamp(p.h),
      };
    } catch {
      return { found: false, x: 0, y: 0, w: 1, h: 1 };
    }
  });

// ---------- Level 1 (Assembly) extractor from title block ----------

const L1_SYSTEM_PROMPT = `You are an expert engineering drawing parser.

OBJECTIVE: Extract ONLY the MAIN ASSEMBLY (Level 1) details from the drawing page:
- Item Code (Assembly) — alphanumeric, e.g. F00801322 (letter + 7-9 digits)
- Drawing Number — pattern like TAG/E/ST/S1/088
- Short Name (optional) — assembly name/description if clearly present

WHERE TO LOOK (ONLY):
- Title Block
- Drawing Header
- Top-right / Bottom-right area

DO NOT EXTRACT FROM:
- BOM / PARTS LIST tables
- Notes section
- Dimensions
- Sub-component tables
- Revision tables
- Balloon callouts

RULES:
- Return ONE assembly only. If multiple candidates exist, prefer the one in the title block.
- If a field is not clearly visible, return an empty string for that field.
- Do NOT guess. Accuracy over completeness.`;

const l1Tool = {
  type: "function" as const,
  function: {
    name: "return_level1_assembly",
    description:
      "Return the Level 1 (main assembly) identifiers from the drawing's title block only.",
    parameters: {
      type: "object",
      properties: {
        found: {
          type: "boolean",
          description:
            "true if the title block clearly contains the assembly identifiers",
        },
        item_code: {
          type: "string",
          description:
            "Assembly item code (letter + 7-9 digits) from the title block, or empty string",
        },
        drawing_no: {
          type: "string",
          description: "Assembly drawing number from the title block, or empty string",
        },
        short_name: {
          type: "string",
          description: "Assembly short name / description, or empty string",
        },
      },
      required: ["found", "item_code", "drawing_no", "short_name"],
      additionalProperties: false,
    },
  },
};

export interface AiLevel1 {
  found: boolean;
  item_code: string;
  drawing_no: string;
  short_name: string;
}

export const extractLevel1Assembly = createServerFn({ method: "POST" })
  .inputValidator((input: { imageDataUrl: string; pageNum: number }) => {
    if (!input || typeof input.imageDataUrl !== "string") {
      throw new Error("imageDataUrl is required");
    }
    if (!input.imageDataUrl.startsWith("data:image/")) {
      throw new Error("imageDataUrl must be a data: URL");
    }
    return input;
  })
  .handler(async ({ data }): Promise<AiLevel1> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: L1_SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Extract the Level 1 (main assembly) identifiers from the title block of this drawing page (page ${data.pageNum}). Use the return_level1_assembly tool. Ignore BOM tables, notes, and dimensions.`,
                },
                { type: "image_url", image_url: { url: data.imageDataUrl } },
              ],
            },
          ],
          tools: [l1Tool],
          tool_choice: {
            type: "function",
            function: { name: "return_level1_assembly" },
          },
        }),
      },
    );

    if (!response.ok) {
      return { found: false, item_code: "", drawing_no: "", short_name: "" };
    }
    const json = await response.json();
    const argsStr =
      json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argsStr) {
      return { found: false, item_code: "", drawing_no: "", short_name: "" };
    }
    try {
      const p = JSON.parse(argsStr) as AiLevel1;
      return {
        found: !!p.found,
        item_code: (p.item_code || "").trim(),
        drawing_no: (p.drawing_no || "").trim(),
        short_name: (p.short_name || "").trim(),
      };
    } catch {
      return { found: false, item_code: "", drawing_no: "", short_name: "" };
    }
  });

export const extractBomFromPageImage = createServerFn({ method: "POST" })
  .inputValidator((input: { imageDataUrl: string; pageNum: number }) => {
    if (!input || typeof input.imageDataUrl !== "string") {
      throw new Error("imageDataUrl is required");
    }
    if (!input.imageDataUrl.startsWith("data:image/")) {
      throw new Error("imageDataUrl must be a data: URL");
    }
    return input;
  })
  .handler(async ({ data }): Promise<AiPageResult> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Extract the BOM table from this engineering drawing page (page ${data.pageNum}). Use the return_bom_table tool to return the result. If no BOM table is clearly identified, set bom_table_found=false and components=[].`,
                },
                {
                  type: "image_url",
                  image_url: { url: data.imageDataUrl },
                },
              ],
            },
          ],
          tools: [extractTool],
          tool_choice: {
            type: "function",
            function: { name: "return_bom_table" },
          },
        }),
      },
    );

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("Rate limit exceeded. Please try again shortly.");
      }
      if (response.status === 402) {
        throw new Error(
          "AI credits exhausted. Add funds in Settings → Workspace → Usage.",
        );
      }
      const text = await response.text();
      throw new Error(`AI gateway error [${response.status}]: ${text}`);
    }

    const json = await response.json();
    const toolCall = json?.choices?.[0]?.message?.tool_calls?.[0];
    const argsStr = toolCall?.function?.arguments;
    if (!argsStr) {
      return {
        bom_table_found: false,
        top_item_code: "",
        top_drawing_no: "",
        components: [],
      };
    }
    try {
      const parsed = JSON.parse(argsStr) as AiPageResult;
      return {
        bom_table_found: !!parsed.bom_table_found,
        top_item_code: (parsed.top_item_code || "").trim(),
        top_drawing_no: (parsed.top_drawing_no || "").trim(),
        components: Array.isArray(parsed.components) ? parsed.components : [],
      };
    } catch {
      return {
        bom_table_found: false,
        top_item_code: "",
        top_drawing_no: "",
        components: [],
      };
    }
  });
