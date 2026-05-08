import type { DwgRow } from "./types";

// Lazy client-only import of pdfjs-dist (avoids SSR resolution failure).
type PdfJs = typeof import("pdfjs-dist");
type PdfDoc = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;
type TextContent = Awaited<
  ReturnType<Awaited<ReturnType<PdfDoc["getPage"]>>["getTextContent"]>
>;

let pdfjsPromise: Promise<PdfJs> | null = null;
async function getPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((mod) => {
      const lib = (mod as unknown as { default?: PdfJs }).default ?? mod;
      lib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${lib.version}/build/pdf.worker.min.mjs`;
      return lib;
    });
  }
  return pdfjsPromise;
}

// ---------- Constants ----------

const ITEM_CODE_RE = /^[A-Z][0-9]{5,9}$/i;
const PAGE_TIMEOUT_MS = 10000;

/**
 * Clean an ITEM CODE cell value. The col[3] may contain the code merged with
 * the start of material text (e.g., "B00210001 S.", "M00504040 F.").
 * Returns the bare code if valid, or null if no code (cell starts with "-" or empty).
 */
function cleanItemCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v) return null;
  if (v.startsWith("-")) return null;
  const first = v.split(/\s+/)[0];
  if (ITEM_CODE_RE.test(first)) return first.toUpperCase();
  return null;
}

// Public types kept for backward compatibility with existing imports
export type StepStatus = "ok" | "partial" | "missing";

export interface Level1Assembly {
  itemCode: string;
  drawingNo: string;
  shortName: string;
  status: StepStatus;
  message?: string;
}

export interface Level2Result {
  topItem: string | null;
  topDrg: string | null;
  rows: { itemCode: string; dwgNo: string; qty: number }[];
  notReadable: number;
  status: StepStatus;
  message?: string;
  pagesProcessed: number;
}

export interface Level3Result {
  groups: Map<
    string,
    { itemCode: string; dwgNo: string; qty: number; pageNum: number }[]
  >;
  notReadable: number;
  status: StepStatus;
  message?: string;
  pagesProcessed: number;
  totalPages: number;
}

export interface ProgressiveResult {
  level1: Level1Assembly;
  level2: Level2Result;
  level3: Level3Result;
  data: DwgRow[];
  notReadable: number;
}

export interface StageCallbacks {
  onLevel1?: (l1: Level1Assembly) => void;
  onLevel2?: (l2: Level2Result) => void;
  onLevel3?: (l3: Level3Result, data: DwgRow[]) => void;
}

// ---------- Per-page text extraction with timeout ----------

async function getPageTextSafe(
  pdf: PdfDoc,
  pageNum: number,
): Promise<TextContent | null> {
  try {
    return await Promise.race<TextContent>([
      pdf.getPage(pageNum).then((p) => p.getTextContent()),
      new Promise<TextContent>((_, rej) =>
        setTimeout(
          () => rej(new Error(`Page ${pageNum} timeout`)),
          PAGE_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (e) {
    console.warn(
      `[PDF] Page ${pageNum} skipped:`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

function getFullText(tc: TextContent): string {
  return tc.items
    .map((i) => ("str" in i ? (i as { str: string }).str : ""))
    .join(" ");
}

// ---------- Title block extraction (strict pattern) ----------

const INVALID_DRG_WORDS = new Set([
  "ITEM", "DESCRIPTION", "CODE", "MATERIAL", "SURFACE", "TREATMENT",
  "PART", "DATE", "DRAWN", "BY", "CKD", "APP", "REV", "SCALE",
  "GENERAL", "NOTE", "TOTAL", "WEIGHT", "INTERNAL", "PROJECT",
  "TECHNICAL", "DATA", "ASSEMBLY", "PROPERTY", "TAG", "CORPORATION",
  "AUTHORIZATION", "APPROX", "INDICATIVE", "ONLY", "DRAWING",
  "NO", "DRG", "QTY", "NOS", "PIECE", "PER", "BILL", "OF",
]);

function isValidDrgNo(val: string | null | undefined): val is string {
  if (!val) return false;
  if (val.length < 3 || val.length > 30) return false;
  if (INVALID_DRG_WORDS.has(val.toUpperCase())) return false;
  // Must contain at least one digit, slash, dot, or hyphen
  if (!/[0-9/.\-]/.test(val)) return false;
  return true;
}

function extractTitleBlock(tc: TextContent): {
  itemCode: string | null;
  drgNo: string | null;
} {
  const text = getFullText(tc);
  const itemMatch = text.match(/ITEM\s*CODE[:\s]+([A-Z][0-9]{7,9})\b/i);

  // DRG.NO: try multiple patterns with validation to avoid picking "ITEM"
  // or other header text when PDF text reflows the title block.
  let drgNo: string | null = null;

  // Pattern A: Full path with multiple slashes (e.g., TAG/E/ST/S1/088)
  if (!drgNo) {
    const m = text.match(/DRG\.?\s*NO[:\s]+([A-Z][A-Z0-9]*(?:\/[A-Z0-9]+){2,})/i);
    if (m && isValidDrgNo(m[1])) drgNo = m[1];
  }

  // Pattern B: Code with dot/hyphen (e.g., DS1601.3, DEA51-03N, BL1600.LT)
  if (!drgNo) {
    const m = text.match(/DRG\.?\s*NO[:\s]+([A-Z][A-Z0-9]{2,12}[.\-][A-Z0-9.\-]+)/i);
    if (m && isValidDrgNo(m[1])) drgNo = m[1];
  }

  // Pattern C: Simple alphanumeric code containing a digit (e.g., DS1600)
  if (!drgNo) {
    const m = text.match(/DRG\.?\s*NO[:\s]+([A-Z0-9][A-Z0-9.\-/]{2,15})/i);
    if (m && isValidDrgNo(m[1])) drgNo = m[1];
  }

  // Pattern D: scan tokens after the DRG.NO label for first valid one
  if (!drgNo) {
    const drgPos = text.search(/DRG\.?\s*NO/i);
    if (drgPos >= 0) {
      const after = text.substring(drgPos).replace(/^DRG\.?\s*NO/i, "").replace(/^[:\s]+/, "");
      const tokens = after.split(/\s+/).slice(0, 8);
      for (const t of tokens) {
        const cleaned = t.replace(/[.\-/]+$/, "");
        if (isValidDrgNo(cleaned)) {
          drgNo = cleaned;
          break;
        }
      }
    }
  }

  if (drgNo) drgNo = drgNo.replace(/[.\-/]+$/, "").toUpperCase();
  if (!drgNo) drgNo = null;

  return {
    itemCode: itemMatch ? itemMatch[1].toUpperCase() : null,
    drgNo,
  };
}

// ---------- BOM table row extraction ----------

const NEVER_DRGNO = new Set([
  "ITEM", "DESCRIPTION", "MATERIAL", "SURFACE", "TREATMENT",
  "PART", "PART.NO", "H.D.G", "HDG", "E.G", "EG",
  "F.S", "M.S", "S.S", "SS", "AL", "ALLOY", "EN19", "BS",
  "IS", "CL", "IV", "NO", "DRG", "CODE", "UTS", "KN",
  "QTY", "NOS", "WEIGHT", "PER", "PIECE", "BILL", "OF",
  "STAINLESS", "STEEL", "TYPE", "AS", "HOT", "DIP",
  "GALVANIZED", "ELECTRO",
]);

const UTS_VALUES = new Set([45, 70, 90, 95, 100, 120, 160, 200, 250]);

interface ColPositions {
  qtyColX: number | null;
  utsColX: number | null;
  codeColX: number | null;
  drgColX: number | null;
  weightColX: number | null;
}

interface RowItem { text: string; x: number }

function buildRowMap(
  tc: TextContent,
  yBucket: number,
): Record<number, RowItem[]> {
  const rowMap: Record<number, RowItem[]> = {};
  for (const item of tc.items) {
    if (!("str" in item)) continue;
    const it = item as { str: string; transform: number[] };
    const y = Math.round(it.transform[5] / yBucket) * yBucket;
    if (!rowMap[y]) rowMap[y] = [];
    rowMap[y].push({ text: it.str.trim(), x: it.transform[4] });
  }
  return rowMap;
}

function detectColumnPositions(
  rowMap: Record<number, RowItem[]>,
): ColPositions {
  const pos: ColPositions = {
    qtyColX: null,
    utsColX: null,
    codeColX: null,
    drgColX: null,
    weightColX: null,
  };
  for (const items of Object.values(rowMap)) {
    const lineUpper = items.map((i) => i.text).join(" ").toUpperCase();
    if (
      lineUpper.includes("QTY") &&
      lineUpper.includes("ITEM") &&
      lineUpper.includes("DRG")
    ) {
      for (const it of items) {
        const t = it.text.toUpperCase();
        if (!t) continue;
        if ((t.includes("QTY") || t.includes("NOS")) && pos.qtyColX === null) {
          pos.qtyColX = it.x;
        }
        if ((t.includes("UTS") || t === "KN" || t.includes("(KN)")) && pos.utsColX === null) {
          pos.utsColX = it.x;
        }
        if (t.includes("CODE") && pos.codeColX === null) {
          pos.codeColX = it.x;
        }
        if (t.startsWith("DRG") && pos.drgColX === null) {
          pos.drgColX = it.x;
        }
        if (t.includes("WEIGHT") && pos.weightColX === null) {
          pos.weightColX = it.x;
        }
      }
      if (pos.qtyColX !== null && pos.codeColX !== null) break;
    }
  }
  return pos;
}

function getTokenAtColumn(
  rowItems: RowItem[],
  targetX: number,
  tolerance = 35,
): string | null {
  let best: string | null = null;
  let bestDist = tolerance;
  for (const it of rowItems) {
    if (!it.text) continue;
    const d = Math.abs(it.x - targetX);
    if (d < bestDist) {
      bestDist = d;
      best = it.text;
    }
  }
  return best;
}

function extractQTYByWeightAnchor(tokensAfter: string[]): number | null {
  let weightIdx = -1;
  for (let i = 0; i < tokensAfter.length; i++) {
    if (/^\d+\.\d+$/.test(tokensAfter[i])) { weightIdx = i; break; }
  }
  if (weightIdx > 0) {
    for (let i = weightIdx - 1; i >= 0; i--) {
      if (/^\d{1,3}$/.test(tokensAfter[i])) {
        const v = parseInt(tokensAfter[i], 10);
        if (!UTS_VALUES.has(v) && v > 0) return v;
      }
    }
    // No clean integer found; fall through and accept first int even if UTS-like
    for (let i = weightIdx - 1; i >= 0; i--) {
      if (/^\d{1,3}$/.test(tokensAfter[i])) return parseInt(tokensAfter[i], 10);
    }
  }
  for (const t of tokensAfter) {
    if (/^\d{1,3}$/.test(t)) {
      const v = parseInt(t, 10);
      if (!UTS_VALUES.has(v) && v > 0) return v;
    }
  }
  return null;
}

function parseBOMRowsFromMap(
  rowMap: Record<number, RowItem[]>,
  colPos: ColPositions,
): { itemCode: string | null; dwgNo: string | null; qty: number }[] {
  const results: { itemCode: string | null; dwgNo: string | null; qty: number }[] = [];

  for (const items of Object.values(rowMap)) {
    const sorted = [...items].sort((a, b) => a.x - b.x);
    const tokens = sorted.map((r) => r.text).filter((t) => t.length > 0);

    // Must start with PART.NO integer 1-20
    if (tokens.length === 0) continue;
    if (!/^\d{1,2}$/.test(tokens[0])) continue;
    if (parseInt(tokens[0], 10) > 20) continue;

    // -------- ITEM CODE --------
    let itemCode: string | null = null;
    let itemIdx = -1;

    // Method 1: position-based
    if (colPos.codeColX !== null) {
      const tok = getTokenAtColumn(items, colPos.codeColX, 45);
      if (tok) {
        const cleaned = cleanItemCode(tok);
        if (cleaned) itemCode = cleaned;
      }
    }
    // Method 2: scan tokens
    for (let i = 1; i < tokens.length; i++) {
      const cleaned = cleanItemCode(tokens[i]);
      if (cleaned) {
        if (!itemCode) itemCode = cleaned;
        if (cleaned === itemCode) { itemIdx = i; break; }
      }
    }

    // -------- DRG.NO --------
    let dwgNo: string | null = null;

    // Method 1: position-based
    if (colPos.drgColX !== null) {
      const tok = getTokenAtColumn(items, colPos.drgColX, 45);
      if (tok && tok !== "-" && tok.length >= 3 &&
          !NEVER_DRGNO.has(tok.toUpperCase()) &&
          /[0-9]/.test(tok) && !ITEM_CODE_RE.test(tok)) {
        dwgNo = tok;
      }
    }
    // Method 2: scan backward from item code
    if (!dwgNo) {
      const dwgEndIdx = itemIdx > 0 ? itemIdx : tokens.length;
      for (let i = dwgEndIdx - 1; i >= 1; i--) {
        const t = tokens[i];
        if (NEVER_DRGNO.has(t.toUpperCase())) continue;
        if (t === "-" || t.length < 3) continue;
        if (!/[0-9]/.test(t)) continue;
        if (ITEM_CODE_RE.test(t)) continue;
        if (/^[A-Z0-9][A-Z0-9./\-()]*$/i.test(t) && t.length <= 20) {
          dwgNo = t;
          break;
        }
      }
    }
    if (dwgNo === "-") dwgNo = null;

    // ══════════════════════════════════════════════
    // CRITICAL: REJECT PHANTOM ROWS
    // A valid BOM row MUST have at least one of:
    //   - a valid item code, OR
    //   - a valid DRG.NO
    // Rows starting with an integer 1-20 but having NEITHER are noise
    // (page dimensions, note line numbers, section labels, etc.)
    // ══════════════════════════════════════════════
    if (!itemCode && !dwgNo) continue;

    // -------- QTY --------
    let qty: number | null = null;

    // Method 1: position-based (with UTS guard)
    if (colPos.qtyColX !== null) {
      const tok = getTokenAtColumn(items, colPos.qtyColX, 35);
      if (tok) {
        const clean = tok.replace(/\s*SET\s*/i, "").trim();
        if (/^\d{1,3}$/.test(clean)) {
          const v = parseInt(clean, 10);
          // Guard: if QTY column overlaps UTS (some drawings), reject UTS-only values
          if (colPos.utsColX === null || Math.abs(colPos.qtyColX - colPos.utsColX) > 20 || !UTS_VALUES.has(v)) {
            qty = v;
          }
        }
      }
    }

    // Method 2: weight-anchor fallback
    if (!qty) {
      const tokensAfter = itemIdx >= 0
        ? tokens.slice(itemIdx + 1)
        : tokens.slice(Math.max(1, Math.floor(tokens.length * 0.5)));
      qty = extractQTYByWeightAnchor(tokensAfter);
    }

    // Method 3: any "1 SET" / first non-UTS integer
    if (!qty) {
      for (const t of tokens) {
        const clean = t.replace(/\s*SET\s*/i, "").trim();
        if (/^\d{1,3}$/.test(clean)) {
          const v = parseInt(clean, 10);
          if (!UTS_VALUES.has(v)) { qty = v; break; }
        }
      }
    }

    if (!qty || qty <= 0) continue;

    // De-duplicate by itemCode when present
    if (itemCode && results.find((r) => r.itemCode === itemCode)) continue;

    results.push({ itemCode, dwgNo, qty });
  }

  return results;
}

function parseBOMRows(
  tc: TextContent,
): { itemCode: string | null; dwgNo: string | null; qty: number }[] {
  // Pass 1: 5px Y bucket
  const map5 = buildRowMap(tc, 5);
  const colPos5 = detectColumnPositions(map5);
  const rows5 = parseBOMRowsFromMap(map5, colPos5);

  // Pass 2: 3px Y bucket — useful for dense pages where rows overlap at 5px
  const map3 = buildRowMap(tc, 3);
  const colPos3 = detectColumnPositions(map3);
  const rows3 = parseBOMRowsFromMap(map3, colPos3);

  // Merge: take whichever pass produced more rows; supplement with rows
  // (by itemCode) only seen in the other pass.
  const primary = rows3.length > rows5.length ? rows3 : rows5;
  const secondary = rows3.length > rows5.length ? rows5 : rows3;
  const seenCodes = new Set(
    primary.map((r) => r.itemCode).filter((c): c is string => !!c),
  );
  const merged = [...primary];
  for (const r of secondary) {
    if (r.itemCode && !seenCodes.has(r.itemCode)) {
      merged.push(r);
      seenCodes.add(r.itemCode);
    }
  }
  return merged;
}

// ---------- Main extraction (sequential, page-by-page) ----------

interface PageData {
  pageNum: number;
  topItem: string | null;
  topDrg: string | null;
  bomRows: { itemCode: string | null; dwgNo: string | null; qty: number }[];
  hasBOM: boolean;
}

const DASH = "—";

export async function extractBOMFromPDF(file: File): Promise<DwgRow[]> {
  const pdfjsLib = await getPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const totalPages = pdf.numPages;
  console.log(`[PDF] Total pages: ${totalPages}`);

  // PASS 1: read all pages sequentially
  const pageDataList: (PageData | null)[] = [];
  const itemToPageIdx: Record<string, number> = {};

  for (let p = 1; p <= totalPages; p++) {
    const tc = await getPageTextSafe(pdf, p);
    if (!tc) {
      pageDataList.push(null);
      continue;
    }
    const fullText = getFullText(tc);
    const hasBOM = fullText.toUpperCase().includes("BILL OF MATERIAL");
    const title = extractTitleBlock(tc);
    const bomRows = hasBOM ? parseBOMRows(tc) : [];

    const data: PageData = {
      pageNum: p,
      topItem: title.itemCode,
      topDrg: title.drgNo,
      bomRows,
      hasBOM,
    };
    pageDataList.push(data);

    if (title.itemCode) {
      itemToPageIdx[title.itemCode] = pageDataList.length - 1;
    }
    console.log(
      `[PDF] Page ${p}: item=${title.itemCode ?? "—"} | drg=${title.drgNo ?? "—"} | BOM rows: ${bomRows.length}`,
    );
    bomRows.forEach((r) =>
      console.log(`  PART code:${r.itemCode ?? "—"} drg:${r.dwgNo ?? "—"} qty:${r.qty}`),
    );
  }

  // PASS 2: find main assembly page
  const mainPage = pageDataList.find(
    (p): p is PageData => !!p && p.hasBOM && p.bomRows.length > 0,
  );
  if (!mainPage) {
    throw new Error(
      "No BOM table found. Ensure PDF has a BILL OF MATERIAL table.",
    );
  }

  // PASS 3: build multi-level BOM tree with effectiveQty propagation
  const allRows: DwgRow[] = [];
  let sl = 1;

  if (mainPage.topItem && mainPage.topDrg) {
    allRows.push({
      slNo: sl++,
      bomLevel: 1,
      itemCode: mainPage.topItem,
      dwgNo: mainPage.topDrg,
      qty: 1,
      dwgQty: 1,
      parentQty: 1,
      parentItemCode: null,
    });
  }

  for (const row2 of mainPage.bomRows) {
    // Bug 2: skip phantom L2 rows that have neither an item code nor a DRG.NO
    if (!row2.itemCode && !row2.dwgNo) continue;

    const l2Effective = row2.qty; // parent (L1) qty is always 1
    allRows.push({
      slNo: sl++,
      bomLevel: 2,
      itemCode: row2.itemCode ?? DASH,
      dwgNo: row2.dwgNo ?? DASH,
      qty: l2Effective,
      dwgQty: row2.qty,
      parentQty: 1,
      parentItemCode: mainPage.topItem,
    });

    // Drill into sub-page only when row has a real item code
    if (!row2.itemCode) continue;
    const subIdx = itemToPageIdx[row2.itemCode];
    if (subIdx === undefined) continue;
    const subPage = pageDataList[subIdx];
    if (!subPage || subPage.bomRows.length === 0) continue;

    for (const row3 of subPage.bomRows) {
      // Skip self-referencing rows
      if (row3.itemCode && row3.itemCode === subPage.topItem) continue;

      const l3Effective = row3.qty * l2Effective;
      allRows.push({
        slNo: sl++,
        bomLevel: 3,
        itemCode: row3.itemCode ?? DASH,
        dwgNo: row3.dwgNo ?? DASH,
        qty: l3Effective,
        dwgQty: row3.qty,
        parentQty: l2Effective,
        parentItemCode: row2.itemCode,
      });

      if (!row3.itemCode) continue;
      const subSubIdx = itemToPageIdx[row3.itemCode];
      if (subSubIdx === undefined) continue;
      const subSubPage = pageDataList[subSubIdx];
      if (!subSubPage || subSubPage.bomRows.length === 0) continue;

      for (const row4 of subSubPage.bomRows) {
        if (row4.itemCode && row4.itemCode === subSubPage.topItem) continue;
        const l4Effective = row4.qty * l3Effective;
        allRows.push({
          slNo: sl++,
          bomLevel: 4,
          itemCode: row4.itemCode ?? DASH,
          dwgNo: row4.dwgNo ?? DASH,
          qty: l4Effective,
          dwgQty: row4.qty,
          parentQty: l3Effective,
          parentItemCode: row3.itemCode,
        });
      }
    }
  }

  console.log(`[PDF] Total extracted rows: ${allRows.length}`);
  return allRows;
}


// ---------- Backward-compatible orchestrator ----------
// Keeps the same call signature used by routes/index.tsx so the UI layer
// continues to work. All staged callbacks fire synchronously after extraction.

export async function parseDrawingPdfStaged(
  file: File,
  callbacks?: StageCallbacks,
): Promise<ProgressiveResult> {
  let data: DwgRow[] = [];
  let extractError: string | null = null;
  try {
    data = await extractBOMFromPDF(file);
  } catch (e) {
    extractError = e instanceof Error ? e.message : "PDF extraction failed";
    console.warn("[PDF] extraction error:", extractError);
  }

  const l1Row = data.find((r) => r.bomLevel === 1);
  const l2Rows = data.filter((r) => r.bomLevel === 2);
  const l3Rows = data.filter((r) => r.bomLevel === 3);

  const level1: Level1Assembly = l1Row
    ? {
        itemCode: l1Row.itemCode,
        drawingNo: l1Row.dwgNo,
        shortName: "",
        status: "ok",
      }
    : {
        itemCode: "",
        drawingNo: "",
        shortName: "",
        status: "missing",
        message: extractError ?? "Level 1 not found",
      };

  const level2: Level2Result = {
    topItem: l1Row ? l1Row.itemCode : null,
    topDrg: l1Row ? l1Row.dwgNo : null,
    rows: l2Rows.map((r) => ({
      itemCode: r.itemCode,
      dwgNo: r.dwgNo,
      qty: r.qty,
    })),
    notReadable: 0,
    status: l2Rows.length > 0 ? "ok" : "missing",
    pagesProcessed: 1,
  };

  const groups = new Map<
    string,
    { itemCode: string; dwgNo: string; qty: number; pageNum: number }[]
  >();
  for (const r of l3Rows) {
    const parent = r.parentItemCode || "Unknown";
    const arr = groups.get(parent) ?? [];
    arr.push({ itemCode: r.itemCode, dwgNo: r.dwgNo, qty: r.qty, pageNum: 0 });
    groups.set(parent, arr);
  }
  const level3: Level3Result = {
    groups,
    notReadable: 0,
    status: groups.size > 0 ? "ok" : "missing",
    pagesProcessed: 0,
    totalPages: 0,
  };

  callbacks?.onLevel1?.(level1);
  callbacks?.onLevel2?.(level2);
  callbacks?.onLevel3?.(level3, data);

  return { level1, level2, level3, data, notReadable: 0 };
}
