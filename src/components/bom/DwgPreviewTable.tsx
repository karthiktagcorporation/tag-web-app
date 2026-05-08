import { ChevronDown, ChevronUp } from "lucide-react";
import type { DwgRow } from "@/lib/bom/types";

interface Props {
  rows: DwgRow[];
  open: boolean;
  onToggle: () => void;
}

export function DwgPreviewTable({ rows, open, onToggle }: Props) {
  if (rows.length === 0) return null;
  const visible = rows.slice(0, 10);
  const more = Math.max(0, rows.length - 10);

  return (
    <div className="mt-4 bg-white rounded-xl shadow-md p-4">
      <button
        onClick={onToggle}
        className="flex items-center justify-between w-full text-sm font-semibold text-gray-700"
      >
        <span>Parsed preview table ({rows.length} rows)</span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr style={{ background: "#EDF2F7" }}>
                <th className="px-2 py-2 text-left font-semibold uppercase">SL NO</th>
                <th className="px-2 py-2 text-left font-semibold uppercase">BOM LEVEL</th>
                <th className="px-2 py-2 text-left font-semibold uppercase">ITEM CODE</th>
                <th className="px-2 py-2 text-left font-semibold uppercase">DRG NO</th>
                <th className="px-2 py-2 text-left font-semibold uppercase">QTY</th>
                <th className="px-2 py-2 text-left font-semibold uppercase">PARENT</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => (
                <tr key={i} className={i % 2 ? "bg-gray-50" : "bg-white"}>
                  <td className="px-2 py-1.5">{r.slNo}</td>
                  <td className="px-2 py-1.5">{r.bomLevel}</td>
                  <td className="px-2 py-1.5">{r.itemCode}</td>
                  <td className="px-2 py-1.5">{r.dwgNo}</td>
                  <td className="px-2 py-1.5">{r.qty}</td>
                  <td className="px-2 py-1.5">{r.parentItemCode ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {more > 0 && (
            <div className="text-xs text-gray-500 mt-2">...and {more} more rows</div>
          )}
        </div>
      )}
    </div>
  );
}
