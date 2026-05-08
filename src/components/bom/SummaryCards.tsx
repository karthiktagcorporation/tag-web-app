import type { Summary } from "@/lib/bom/types";

interface Props {
  summary: Summary;
}

const cards: { key: keyof Summary; label: string; bg: string }[] = [
  { key: "total", label: "Total Items", bg: "#2D3748" },
  { key: "matched", label: "Matched", bg: "#38A169" },
  { key: "mismatched", label: "Mismatched", bg: "#E53E3E" },
  { key: "notReadable", label: "Not Readable", bg: "#DD6B20" },
  { key: "notFound", label: "Not Found", bg: "#718096" },
];

export function SummaryCards({ summary }: Props) {
  return (
    <div className="flex flex-wrap gap-4">
      {cards.map((c) => (
        <div
          key={c.key}
          className="text-white"
          style={{
            background: c.bg,
            borderRadius: 12,
            padding: "20px 24px",
            flex: 1,
            minWidth: 140,
          }}
        >
          <div style={{ fontSize: 32, fontWeight: 700, marginBottom: 4 }}>
            {summary[c.key]}
          </div>
          <div style={{ fontSize: 13, fontWeight: 400, opacity: 0.85 }}>
            {c.label}
          </div>
        </div>
      ))}
    </div>
  );
}
