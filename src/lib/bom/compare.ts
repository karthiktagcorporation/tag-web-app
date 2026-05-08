import type { DwgRow, ErpRow, ResultRow, Summary } from "./types";

/**
 * ERP tree node — built from the flat Excel rows preserving order.
 * Parent relationships are derived from BOM Level indentation.
 */
interface ErpNode {
  itemCode: string;
  shortName: string;
  qty: string | number;
  bomLevel: number;
  parentItemCode: string | null;
  children: ErpNode[];
}

/** Build ERP tree from the flat (in-order) ERP rows. */
function buildErpTree(erpData: ErpRow[]): ErpNode[] {
  const tree: ErpNode[] = [];
  const parentStack: (ErpNode | null)[] = [];

  for (const row of erpData) {
    const code = String(row.itemCode || "").trim().toUpperCase();
    if (!code) continue;
    const level = parseInt(String(row.bomLevel), 10) || 1;

    const node: ErpNode = {
      itemCode: code,
      shortName: String(row.shortName ?? "").trim(),
      qty: row.qty,
      bomLevel: level,
      parentItemCode: null,
      children: [],
    };

    if (level <= 1) {
      node.parentItemCode = null;
      tree.push(node);
      parentStack[1] = node;
      // clear deeper levels
      for (let l = 2; l < parentStack.length; l++) parentStack[l] = null;
    } else {
      const parent = parentStack[level - 1] || null;
      if (parent) {
        node.parentItemCode = parent.itemCode;
        parent.children.push(node);
      } else {
        tree.push(node);
      }
      parentStack[level] = node;
      for (let l = level + 1; l < parentStack.length; l++) parentStack[l] = null;
    }
  }

  return tree;
}

/**
 * Build a lookup map keyed by:
 *   "level:ITEMCODE:PARENTCODE"   (exact)
 *   "level:ITEMCODE"              (fallback if parent unknown)
 *   "ITEMCODE"                    (last-resort fallback)
 *
 * For non-exact keys we only set the FIRST node we encounter so we don't
 * silently overwrite a previously-seen variant. The exact (parent-aware)
 * key is the one that matters for duplicate item codes under different
 * parents — and it is unique by construction.
 */
function buildErpLookup(erpData: ErpRow[]): {
  lookup: Map<string, ErpNode>;
  allNodes: ErpNode[];
} {
  const tree = buildErpTree(erpData);
  const lookup = new Map<string, ErpNode>();
  const allNodes: ErpNode[] = [];

  const visit = (node: ErpNode) => {
    allNodes.push(node);
    const exactKey = `${node.bomLevel}:${node.itemCode}:${node.parentItemCode || ""}`;
    const levelKey = `${node.bomLevel}:${node.itemCode}`;
    const codeKey = node.itemCode;

    // exact key MUST overwrite — but it should be unique anyway
    lookup.set(exactKey, node);
    if (!lookup.has(levelKey)) lookup.set(levelKey, node);
    if (!lookup.has(codeKey)) lookup.set(codeKey, node);

    for (const child of node.children) visit(child);
  };

  for (const root of tree) visit(root);
  return { lookup, allNodes };
}

/** Build a parent map (used to resolve display parent for unmatched dwg rows). */
function buildErpParentMap(erpData: ErpRow[]): Map<string, string> {
  const parentMap = new Map<string, string>();
  const stack: string[] = [];
  for (const row of erpData) {
    const code = String(row.itemCode).toUpperCase().trim();
    if (!code) continue;
    const lvl = parseInt(String(row.bomLevel), 10);
    if (isNaN(lvl) || lvl <= 0) continue;
    if (lvl > 1) {
      const parent = stack[lvl - 1];
      if (parent) parentMap.set(code, parent);
    }
    stack[lvl] = code;
    stack.length = lvl + 1;
  }
  return parentMap;
}

export function runChecking1(
  dwgData: DwgRow[],
  erpData: ErpRow[],
  notReadableCount: number,
): { summary: Summary; results: ResultRow[] } {
  const { lookup: erpLookup, allNodes } = buildErpLookup(erpData);
  const erpParentMap = buildErpParentMap(erpData);

  const resolveParent = (
    drawingParent: string | null,
    itemCodeDwg: string,
    itemCodeErp: string,
  ): string | null => {
    const dp = (drawingParent || "").trim();
    if (dp) return dp;
    const lookupKey = (itemCodeErp || itemCodeDwg || "").toUpperCase().trim();
    if (!lookupKey) return null;
    return erpParentMap.get(lookupKey) ?? null;
  };

  const formatQtyDwg = (dwg: DwgRow): string => {
    const lvl = Number(dwg.bomLevel);
    if (
      lvl >= 3 &&
      typeof dwg.dwgQty === "number" &&
      typeof dwg.parentQty === "number" &&
      dwg.parentQty !== 1
    ) {
      return `${dwg.qty} (${dwg.dwgQty}×${dwg.parentQty})`;
    }
    return String(dwg.qty);
  };

  const results: ResultRow[] = [];
  // Track which ERP nodes were consumed by a matching DWG row.
  // Use a Set of the unique exact keys.
  const matchedExactKeys = new Set<string>();

  dwgData.forEach((dwg, idx) => {
    const rawCode = String(dwg.itemCode || "").trim();
    const hasCode = rawCode && rawCode !== "—" && rawCode !== "-";

    if (!hasCode) {
      results.push({
        slNo: idx + 1,
        bomLevel: dwg.bomLevel,
        parentItemCode: dwg.parentItemCode,
        itemCodeDwg: "—",
        itemCodeErp: "—",
        dwgNo: dwg.dwgNo,
        shortNameErp: "—",
        qtyDwg: formatQtyDwg(dwg),
        qtyErp: "—",
        bomLevelErp: "—",
        status: "NO CODE",
        levelMismatch: false,
        nameMismatch: false,
        qtyMismatch: false,
      });
      return;
    }

    const dwgKey = rawCode.toUpperCase();
    const dwgLevel = parseInt(String(dwg.bomLevel), 10);
    const dwgParent = (dwg.parentItemCode || "").toUpperCase().trim();

    // Strategy 1: exact (level + code + parent)
    const exactKey = `${dwgLevel}:${dwgKey}:${dwgParent}`;
    // Strategy 2: level + code (fallback)
    const levelKey = `${dwgLevel}:${dwgKey}`;
    // Strategy 3: code only
    const codeKey = dwgKey;

    const erp =
      erpLookup.get(exactKey) ||
      erpLookup.get(levelKey) ||
      erpLookup.get(codeKey);

    if (!erp) {
      results.push({
        slNo: idx + 1,
        bomLevel: dwg.bomLevel,
        parentItemCode: resolveParent(dwg.parentItemCode, dwg.itemCode, ""),
        itemCodeDwg: dwg.itemCode,
        itemCodeErp: "—",
        dwgNo: dwg.dwgNo,
        shortNameErp: "—",
        qtyDwg: formatQtyDwg(dwg),
        qtyErp: "—",
        bomLevelErp: "—",
        status: "MISSING IN ERP",
        levelMismatch: false,
        nameMismatch: false,
        qtyMismatch: false,
      });
      return;
    }

    // Mark this specific ERP node as consumed
    const erpExactKey = `${erp.bomLevel}:${erp.itemCode}:${erp.parentItemCode || ""}`;
    matchedExactKeys.add(erpExactKey);

    const erpLvl = erp.bomLevel;
    const levelMatch = !isNaN(dwgLevel) ? dwgLevel === erpLvl : true;

    const dwgNoStr = String(dwg.dwgNo ?? "").trim();
    const hasDwgNo = !!dwgNoStr && dwgNoStr !== "—" && dwgNoStr !== "-";
    const nameMatch = !hasDwgNo
      ? true
      : dwgNoStr.toUpperCase() === erp.shortName.trim().toUpperCase();

    const qtyMatch = dwg.qty === parseInt(String(erp.qty), 10);
    const allMatch = levelMatch && nameMatch && qtyMatch;
    const status = allMatch ? "MATCH" : "MISMATCH";

    results.push({
      slNo: idx + 1,
      bomLevel: dwg.bomLevel,
      parentItemCode: resolveParent(
        dwg.parentItemCode,
        dwg.itemCode,
        erp.itemCode,
      ),
      itemCodeDwg: dwg.itemCode,
      itemCodeErp: erp.itemCode,
      dwgNo: dwg.dwgNo,
      shortNameErp: erp.shortName,
      qtyDwg: formatQtyDwg(dwg),
      qtyErp: erp.qty,
      bomLevelErp: erp.bomLevel,
      status,
      levelMismatch: !levelMatch,
      nameMismatch: !nameMatch,
      qtyMismatch: !qtyMatch,
    });
  });

  // EXTRA IN ERP — any ERP node whose exact key was not consumed
  for (const erp of allNodes) {
    const exactKey = `${erp.bomLevel}:${erp.itemCode}:${erp.parentItemCode || ""}`;
    if (matchedExactKeys.has(exactKey)) continue;
    results.push({
      slNo: results.length + 1,
      bomLevel: erp.bomLevel,
      parentItemCode: erp.parentItemCode,
      itemCodeDwg: "—",
      itemCodeErp: erp.itemCode,
      dwgNo: "—",
      shortNameErp: erp.shortName,
      qtyDwg: "—",
      qtyErp: erp.qty,
      bomLevelErp: erp.bomLevel,
      status: "EXTRA IN ERP",
      levelMismatch: false,
      nameMismatch: false,
      qtyMismatch: false,
    });
  }

  const summary: Summary = {
    total: dwgData.length,
    matched: results.filter((r) => r.status === "MATCH").length,
    mismatched: results.filter((r) => r.status === "MISMATCH").length,
    notReadable: notReadableCount || 0,
    notFound: results.filter((r) => r.status === "MISSING IN ERP").length,
  };

  return { summary, results };
}
