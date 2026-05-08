import * as XLSX from "xlsx";
import type { ResultRow } from "./types";

const LEVEL_TITLES: Record<number, string> = {
  1: "LEVEL 1 — ASSEMBLY",
  2: "LEVEL 2 — CHILD COMPONENTS",
  3: "LEVEL 3 — SUB COMPONENTS",
  4: "LEVEL 4 — DEEP SUB COMPONENTS",
};

const HEADERS = [
  "Sl No",
  "BOM Level",
  "Parent Item Code",
  "Item Code (DWG)",
  "Item Code (ERP)",
  "Dwg No",
  "Short Name (ERP)",
  "Qty (DWG)",
  "Qty (ERP)",
  "Status",
];

function rowToArr(r: ResultRow, idx: number): (string | number)[] {
  return [
    idx,
    r.bomLevel,
    r.parentItemCode ?? "",
    r.itemCodeDwg,
    r.itemCodeErp,
    r.dwgNo,
    r.shortNameErp,
    r.qtyDwg,
    r.qtyErp,
    r.status,
  ];
}

export function exportToExcel(results: ResultRow[]) {
  const groups: Record<number, ResultRow[]> = { 1: [], 2: [], 3: [], 4: [] };
  const extras: ResultRow[] = [];

  for (const r of results) {
    if (r.status === "EXTRA IN ERP") {
      extras.push(r);
      continue;
    }
    const lvl = parseInt(String(r.bomLevel), 10);
    if (groups[lvl]) groups[lvl].push(r);
  }

  const aoa: (string | number)[][] = [];
  aoa.push(HEADERS);

  const headerRowIndices: number[] = [];

  const pushSection = (title: string, rows: ResultRow[]) => {
    if (rows.length === 0) return;
    aoa.push([]); // blank separator
    headerRowIndices.push(aoa.length); // 1-indexed for merge
    aoa.push([title, "", "", "", "", "", "", "", "", ""]);
    rows.forEach((r, i) => aoa.push(rowToArr(r, i + 1)));
  };

  pushSection(LEVEL_TITLES[1], groups[1]);
  pushSection(LEVEL_TITLES[2], groups[2]);

  // Group by parent, ordered to follow the parent-level sequence
  const groupByParentOrdered = (
    rows: ResultRow[],
    parentSequence: string[],
  ): Array<[string, ResultRow[]]> => {
    const map = new Map<string, ResultRow[]>();
    for (const r of rows) {
      const raw = (r.parentItemCode || "").trim().toUpperCase();
      const key = raw || "UNKNOWN";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    const ordered: Array<[string, ResultRow[]]> = [];
    const seen = new Set<string>();
    for (const p of parentSequence) {
      const key = (p || "").trim().toUpperCase();
      if (key && map.has(key) && !seen.has(key)) {
        ordered.push([key, map.get(key)!]);
        seen.add(key);
      }
    }
    for (const [k, v] of map.entries()) {
      if (!seen.has(k)) ordered.push([k, v]);
    }
    return ordered;
  };

  const level2Sequence = groups[2].map((r) => r.itemCodeDwg);
  const level3Sequence = groups[3].map((r) => r.itemCodeDwg);

  if (groups[3].length > 0) {
    aoa.push([]);
    headerRowIndices.push(aoa.length);
    aoa.push([LEVEL_TITLES[3], "", "", "", "", "", "", "", "", ""]);
    const l3 = groupByParentOrdered(groups[3], level2Sequence);
    l3.forEach(([parent, rows]) => {
      aoa.push([`📦 Parent: ${parent}`]);
      rows.forEach((r, i) => aoa.push(rowToArr(r, i + 1)));
    });
  }

  if (groups[4].length > 0) {
    aoa.push([]);
    headerRowIndices.push(aoa.length);
    aoa.push([LEVEL_TITLES[4], "", "", "", "", "", "", "", "", ""]);
    const l4 = groupByParentOrdered(groups[4], level3Sequence);
    l4.forEach(([parent, rows]) => {
      aoa.push([`📦 Parent: ${parent}`]);
      rows.forEach((r, i) => aoa.push(rowToArr(r, i + 1)));
    });
  }

  pushSection("EXTRA IN ERP", extras);

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  ws["!cols"] = [
    { wch: 8 },
    { wch: 10 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 16 },
    { wch: 22 },
    { wch: 10 },
    { wch: 10 },
    { wch: 18 },
  ];

  // Merge level header rows across all columns and bold them
  ws["!merges"] = ws["!merges"] || [];
  for (const r of headerRowIndices) {
    const rowZero = r - 1;
    ws["!merges"].push({
      s: { r: rowZero, c: 0 },
      e: { r: rowZero, c: HEADERS.length - 1 },
    });
    const cellRef = XLSX.utils.encode_cell({ r: rowZero, c: 0 });
    if (ws[cellRef]) {
      ws[cellRef].s = { font: { bold: true } };
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Checking-1 Result");

  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .substring(0, 15);
  XLSX.writeFile(wb, `Checking1_Result_${timestamp}.xlsx`);
}
