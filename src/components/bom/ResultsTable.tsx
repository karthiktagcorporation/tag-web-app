import { Download } from "lucide-react";
import type { ResultRow, Status } from "@/lib/bom/types";
import { exportToExcel } from "@/lib/bom/exportExcel";

interface Props {
  results: ResultRow[];
}

const rowStyle: Record<Status, { border: string; bg: string }> = {
  MATCH: { border: "#38A169", bg: "#F0FFF4" },
  MISMATCH: { border: "#E53E3E", bg: "#FFF5F5" },
  "MISSING IN ERP": { border: "#3182CE", bg: "#EBF8FF" },
  "EXTRA IN ERP": { border: "#D69E2E", bg: "#FFFFF0" },
  "NO CODE": { border: "#A0AEC0", bg: "#F7FAFC" },
};

const pillStyle: Record<Status, { bg: string; color: string }> = {
  MATCH: { bg: "#C6F6D5", color: "#276749" },
  MISMATCH: { bg: "#FED7D7", color: "#C53030" },
  "MISSING IN ERP": { bg: "#BEE3F8", color: "#2C5282" },
  "EXTRA IN ERP": { bg: "#FEFCBF", color: "#744210" },
  "NO CODE": { bg: "#E2E8F0", color: "#4A5568" },
};

const headers = [
  "Sl No",
  "Item Code (DWG)",
  "Item Code (ERP)",
  "Dwg No",
  "Short Name (ERP)",
  "Qty (DWG)",
  "Qty (ERP)",
  "Status",
];

const LEVEL_META: Record<
  number,
  { color: string; title: string }
> = {
  1: { color: "#2B6CB0", title: "LEVEL 1 — ASSEMBLY" },
  2: { color: "#2F855A", title: "LEVEL 2 — CHILD COMPONENTS" },
  3: { color: "#744210", title: "LEVEL 3 — SUB COMPONENTS" },
  4: { color: "#553C9A", title: "LEVEL 4 — DEEP SUB COMPONENTS" },
};

function lvlNum(v: number | string): number {
  const n = parseInt(String(v), 10);
  return isNaN(n) ? 0 : n;
}

function ResultRowsTable({ rows }: { rows: ResultRow[] }) {
  const cellHi = {
    background: "#FED7D7",
    color: "#C53030",
    fontWeight: 600,
  } as const;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr style={{ background: "#EDF2F7" }}>
            {headers.map((h) => (
              <th
                key={h}
                className="text-left"
                style={{
                  padding: "8px 12px",
                  fontSize: 11,
                  textTransform: "uppercase",
                  fontWeight: 600,
                  color: "#4A5568",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const rs = rowStyle[r.status];
            const ps = pillStyle[r.status];
            // Standard hardware (bolt/nut/washer/split pin) has no DRG.NO in
            // the drawing — never highlight DWG NO / Short Name cells red
            // for these rows.
            const dwgStr = String(r.dwgNo ?? "").trim();
            const noDrawing = !dwgStr || dwgStr === "—" || dwgStr === "-";
            const showNameHi = r.nameMismatch && !noDrawing;
            return (
              <tr
                key={`${r.slNo}-${r.itemCodeDwg}-${r.itemCodeErp}-${i}`}
                style={{
                  background: rs.bg,
                  borderLeft: `4px solid ${rs.border}`,
                }}
              >
                <td className="px-3 py-2">{i + 1}</td>
                <td className="px-3 py-2 font-mono">{r.itemCodeDwg}</td>
                <td className="px-3 py-2 font-mono">{r.itemCodeErp}</td>
                <td
                  className="px-3 py-2"
                  style={showNameHi ? cellHi : undefined}
                >
                  {r.dwgNo}
                </td>
                <td
                  className="px-3 py-2"
                  style={showNameHi ? cellHi : undefined}
                >
                  {r.shortNameErp}
                </td>
                <td
                  className="px-3 py-2"
                  style={r.qtyMismatch ? cellHi : undefined}
                >
                  {String(r.qtyDwg)}
                </td>
                <td
                  className="px-3 py-2"
                  style={r.qtyMismatch ? cellHi : undefined}
                >
                  {String(r.qtyErp)}
                </td>
                <td className="px-3 py-2">
                  <span
                    className="inline-block rounded-full px-3 py-1 text-xs font-semibold"
                    style={{ background: ps.bg, color: ps.color }}
                  >
                    {r.status}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LevelHeader({ level }: { level: number }) {
  const meta = LEVEL_META[level];
  if (!meta) return null;
  return (
    <div
      style={{
        fontSize: 16,
        fontWeight: 600,
        color: meta.color,
        borderLeft: `4px solid ${meta.color}`,
        padding: "12px 0 8px 12px",
        marginTop: 24,
      }}
    >
      ◆ {meta.title}
    </div>
  );
}

function ParentLabel({ parent }: { parent: string }) {
  return (
    <div
      style={{
        fontSize: 13,
        color: "#4A5568",
        background: "#EDF2F7",
        borderRadius: 6,
        padding: "4px 12px",
        margin: "8px 0 4px 0",
        display: "inline-block",
      }}
    >
      📦 Parent: {parent}
    </div>
  );
}

export function ResultsTable({ results }: Props) {
  const level1 = results.filter((r) => lvlNum(r.bomLevel) === 1);
  const level2 = results.filter((r) => lvlNum(r.bomLevel) === 2);
  const level3 = results.filter((r) => lvlNum(r.bomLevel) === 3);
  const level4 = results.filter((r) => lvlNum(r.bomLevel) === 4);
  const extras = results.filter((r) => r.status === "EXTRA IN ERP");

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
    // Append any parents not present in the sequence (orphans / UNKNOWN) last
    for (const [k, v] of map.entries()) {
      if (!seen.has(k)) ordered.push([k, v]);
    }
    return ordered;
  };

  const level2Sequence = level2.map((r) => r.itemCodeDwg);
  const level3Sequence = level3.map((r) => r.itemCodeDwg);
  const level3Groups = groupByParentOrdered(level3, level2Sequence);
  const level4Groups = groupByParentOrdered(level4, level3Sequence);

  return (
    <div className="bg-white rounded-xl shadow-md p-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold text-gray-800">
          Checking-1 Result
        </h2>
        <button
          onClick={() => exportToExcel(results)}
          className="inline-flex items-center gap-2 border border-green-600 text-green-700 hover:bg-green-600 hover:text-white transition-colors rounded-md px-3 py-2 text-sm font-medium"
        >
          <Download className="h-4 w-4" />
          Export to Excel
        </button>
      </div>

      {level1.length > 0 && (
        <>
          <LevelHeader level={1} />
          <ResultRowsTable rows={level1} />
        </>
      )}

      {level2.length > 0 && (
        <>
          <LevelHeader level={2} />
          <ResultRowsTable rows={level2} />
        </>
      )}

      {level3Groups.length > 0 && (
        <>
          <LevelHeader level={3} />
          {level3Groups.map(([parent, rows]) => (
            <div key={`l3-${parent}`}>
              <ParentLabel parent={parent} />
              <ResultRowsTable rows={rows} />
            </div>
          ))}
        </>
      )}

      {level4Groups.length > 0 && (
        <>
          <LevelHeader level={4} />
          {level4Groups.map(([parent, rows]) => (
            <div key={`l4-${parent}`}>
              <ParentLabel parent={parent} />
              <ResultRowsTable rows={rows} />
            </div>
          ))}
        </>
      )}

      {extras.length > 0 && (
        <>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "#D69E2E",
              borderLeft: "4px solid #D69E2E",
              padding: "12px 0 8px 12px",
              marginTop: 24,
            }}
          >
            ◆ EXTRA IN ERP
          </div>
          <ResultRowsTable rows={extras} />
        </>
      )}
    </div>
  );
}
