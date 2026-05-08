import * as XLSX from "xlsx";
import type { ErpRow } from "./types";

export async function parseErpExcel(file: File): Promise<ErpRow[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
  }) as unknown[][];

  const normalizeCell = (s: unknown) =>
    String(s ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");

  // Find header row containing a normalized "ITEMCODE"
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.some((c) => normalizeCell(c) === "ITEMCODE" || normalizeCell(c) === "PARTCODE")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error(
      "Could not read Excel file. Ensure columns include: Item Code, Short Name, Qty, BOM Level",
    );
  }

  // Normalize headers: uppercase + strip non-alphanumerics
  // e.g. "Short-Name" / "short_name" / "Short Name" → "SHORTNAME"
  const normalize = (s: unknown) =>
    String(s ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");

  const header = rows[headerIdx].map(normalize);

  const findByAliases = (aliases: string[]): number => {
    // exact match first
    for (const a of aliases) {
      const idx = header.indexOf(a);
      if (idx !== -1) return idx;
    }
    // then contains match
    for (const a of aliases) {
      const idx = header.findIndex((h) => h.includes(a));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const slIdx = findByAliases(["SLNO", "SL", "SERIALNO", "SRNO", "SNO"]);
  const lvlIdx = findByAliases(["BOMLEVEL", "LEVEL"]);
  const codeIdx = findByAliases(["ITEMCODE", "PARTCODE", "MATERIALCODE", "CODE"]);
  const nameIdx = findByAliases(["SHORTNAME", "DESCRIPTION", "ITEMNAME", "PARTNAME", "NAME"]);
  const qtyIdx = findByAliases(["QTY", "QUANTITY", "REQQTY"]);

  if (codeIdx === -1 || nameIdx === -1 || qtyIdx === -1) {
    throw new Error(
      "Could not read Excel file. Ensure columns include: Item Code, Short Name, Qty, BOM Level",
    );
  }

  const out: ErpRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const itemCode = String(r[codeIdx] ?? "").trim();
    if (!itemCode) continue;
    out.push({
      slNo: slIdx !== -1 ? String(r[slIdx] ?? "").trim() : out.length + 1,
      bomLevel: lvlIdx !== -1 ? String(r[lvlIdx] ?? "").trim() : "",
      itemCode,
      shortName: String(r[nameIdx] ?? "").trim(),
      qty: String(r[qtyIdx] ?? "").trim(),
    });
  }

  if (out.length === 0) {
    throw new Error(
      "Could not read Excel file. Ensure columns include: Item Code, Short Name, Qty, BOM Level",
    );
  }

  return out;
}
