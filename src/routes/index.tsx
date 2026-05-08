import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Cog, RotateCcw, AlertCircle } from "lucide-react";
import { UploadCard } from "@/components/bom/UploadCard";
import { ErpPreviewTable } from "@/components/bom/ErpPreviewTable";
import { DwgPreviewTable } from "@/components/bom/DwgPreviewTable";
import { SummaryCards } from "@/components/bom/SummaryCards";
import { ResultsTable } from "@/components/bom/ResultsTable";
import { parseErpExcel } from "@/lib/bom/parseErp";
import { parseDrawingPdfStaged } from "@/lib/bom/parsePdf";
import { runChecking1 } from "@/lib/bom/compare";
import type { ErpRow, DwgRow, ResultRow, Summary } from "@/lib/bom/types";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "BOM Checking-1 Comparison System" },
      {
        name: "description",
        content:
          "Compare Engineering Drawing BOM against ERP BOM. Upload an Excel ERP BOM and a PDF drawing to instantly identify matched, mismatched, missing, and extra items.",
      },
    ],
  }),
});

function Index() {
  // Render entry point
  const [erpFile, setErpFile] = useState<File | null>(null);
  const [dwgFile, setDwgFile] = useState<File | null>(null);
  const [erpData, setErpData] = useState<ErpRow[]>([]);
  const [dwgData, setDwgData] = useState<DwgRow[]>([]);
  const [erpUploading, setErpUploading] = useState(false);
  const [dwgUploading, setDwgUploading] = useState(false);
  const [erpError, setErpError] = useState("");
  const [dwgError, setDwgError] = useState("");
  const [erpPreviewOpen, setErpPreviewOpen] = useState(true);
  const [dwgPreviewOpen, setDwgPreviewOpen] = useState(true);
  const [notReadableCount, setNotReadableCount] = useState(0);
  const [comparing, setComparing] = useState(false);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [runError, setRunError] = useState("");

  const handleErp = async (file: File) => {
    setErpError("");
    setErpUploading(true);
    setErpFile(file);
    try {
      const data = await parseErpExcel(file);
      setErpData(data);
    } catch (e) {
      setErpData([]);
      setErpFile(null);
      setErpError(
        e instanceof Error
          ? e.message
          : "Could not read Excel file. Ensure columns include: Item Code, Short Name, Qty, BOM Level",
      );
    } finally {
      setErpUploading(false);
    }
  };

  const handleDwg = async (file: File) => {
    setDwgError("");
    setDwgUploading(true);
    setDwgFile(file);
    setDwgData([]);
    try {
      const r = await parseDrawingPdfStaged(file);
      setDwgData(r.data);
      setNotReadableCount(r.notReadable);
    } catch (e) {
      setDwgData([]);
      setNotReadableCount(0);
      setDwgError(
        e instanceof Error
          ? e.message
          : "No valid BOM table found in PDF. Ensure drawing has a BOM table with: DRG.NO, ITEM CODE, QTY (NOS.) columns and item codes like G00211094 (letter + 8 digits)",
      );
    } finally {
      setDwgUploading(false);
    }
  };

  const canRun = erpData.length > 0 && !!dwgFile && !comparing;

  const handleRun = () => {
    if (erpData.length === 0 || !dwgFile) {
      setRunError(
        "Please upload both ERP BOM Excel and Engineering Drawing PDF before running comparison",
      );
      return;
    }
    setRunError("");
    setComparing(true);
    try {
      const { summary, results } = runChecking1(
        dwgData,
        erpData,
        notReadableCount,
      );
      setResults(results);
      setSummary(summary);
    } finally {
      setComparing(false);
    }
  };

  const handleReset = () => {
    setErpFile(null);
    setDwgFile(null);
    setErpData([]);
    setDwgData([]);
    setErpUploading(false);
    setDwgUploading(false);
    setErpError("");
    setDwgError("");
    setErpPreviewOpen(true);
    setNotReadableCount(0);
    setComparing(false);
    setResults([]);
    setSummary(null);
    setRunError("");
  };

  return (
    <div style={{ background: "#F7FAFC", minHeight: "100vh" }}>
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-[1400px] mx-auto px-6 py-5 flex items-center gap-4">
          <div className="flex items-center justify-center h-11 w-11 rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 text-white">
            <Cog className="h-6 w-6" />
          </div>
          <div className="flex-1 text-center">
            <h1 className="text-xl md:text-2xl font-bold text-gray-800 tracking-tight">
              BOM Checking-1 Comparison System
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Engineering Drawing vs ERP BOM Verification
            </p>
          </div>
          <div className="w-11" />
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-8">
        {/* Section 1 — Upload Area */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <UploadCard
              theme="green"
              title="ERP BOM Excel"
              subtitle="Click or drag .xlsx file here"
              accept={{
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                  [".xlsx"],
                "application/vnd.ms-excel": [".xls"],
              }}
              uploading={erpUploading}
              fileName={erpData.length > 0 ? erpFile?.name ?? null : null}
              successDetail={
                erpData.length > 0 ? `${erpData.length} rows parsed` : null
              }
              onFile={handleErp}
            />
            {erpError && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>{erpError}</div>
              </div>
            )}
            <ErpPreviewTable
              rows={erpData}
              open={erpPreviewOpen}
              onToggle={() => setErpPreviewOpen((v) => !v)}
            />
          </div>

          <div>
            <UploadCard
              theme="purple"
              title="Engineering Drawing PDF"
              subtitle="Click or drag .pdf file here"
              accept={{ "application/pdf": [".pdf"] }}
              uploading={dwgUploading}
              fileName={dwgFile && !dwgUploading ? dwgFile.name : null}
              successDetail={
                dwgFile && !dwgUploading
                  ? dwgData.length > 0
                    ? `${dwgData.length} rows extracted from drawing`
                    : "Drawing accepted (extraction skipped)"
                  : null
              }
              onFile={handleDwg}
            />
            {dwgError && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>{dwgError}</div>
              </div>
            )}
            <DwgPreviewTable
              rows={dwgData}
              open={dwgPreviewOpen}
              onToggle={() => setDwgPreviewOpen((v) => !v)}
            />
          </div>
        </section>

        {/* Section 2 — Action Buttons */}
        <section className="mt-6 flex items-center justify-center gap-4">
          <button
            onClick={handleRun}
            disabled={!canRun}
            className="text-white font-semibold rounded-full px-10 py-3 transition-opacity disabled:cursor-not-allowed"
            style={{
              background: canRun
                ? "linear-gradient(180deg, #FC8181, #F56565)"
                : "#CBD5E0",
              boxShadow: canRun ? "0 4px 12px rgba(245,101,101,0.3)" : "none",
            }}
          >
            {comparing ? "Running..." : "Run Comparison"}
          </button>
          <button
            onClick={handleReset}
            className="inline-flex items-center gap-2 bg-white border border-gray-300 rounded-full px-7 py-3 text-gray-700 font-medium hover:bg-gray-50"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
        </section>

        {runError && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>{runError}</div>
          </div>
        )}

        {/* Section 3 — Results */}
        {summary && (
          <section className="mt-8 space-y-6">
            <SummaryCards summary={summary} />
            <ResultsTable results={results} />
          </section>
        )}
      </main>
    </div>
  );
}
