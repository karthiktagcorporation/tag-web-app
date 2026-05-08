
# BOM Checking-1 Comparison System

A fully client-side web app that compares an ERP BOM (Excel) against an Engineering Drawing BOM (PDF) and produces a row-by-row Checking-1 report — automating what an engineer would do manually.

## Pages & Routes
- `/` (single page app) — header + upload section + actions + results, all on one route.

## Page Layout

**Header**
- Left: gear/document icon
- Center: "BOM Checking-1 Comparison System" with subtitle "Engineering Drawing vs ERP BOM Verification"
- White background, subtle bottom shadow

**Body** — light gray (#F7FAFC), max-width 1400px, centered

### Section 1 — Upload Area (two cards side by side)

**Left card — ERP BOM Upload**
- Green dashed dropzone (#48BB78), hover bg #F0FFF4
- Accepts `.xlsx` only
- After upload: green ✓, filename, spinner during parsing
- Collapsible preview table beneath: SL NO | BOM LEVEL | ITEM CODE | SHORT NAME | QTY (first 10 rows + "...and N more")

**Right card — Drawing BOM Upload**
- Purple dashed dropzone (#805AD5), hover bg #FAF5FF
- Accepts `.pdf` only
- After upload: purple ✓, filename, "X rows extracted from drawing"
- No preview table

**Error box** — red bordered alert per card on parse failure, with the exact messages specified.

### Section 2 — Action Buttons (centered)
- **Run Comparison** — pink/red gradient pill (#FC8181 → #F56565), disabled until both files parsed
- **Reset** — white pill with gray border, clears all state

### Section 3 — Results (after Run Comparison)

**A) Five summary stat cards in a row** with exact colors:
- Total Items (#2D3748) · Matched (#38A169) · Mismatched (#E53E3E) · Not Readable (#DD6B20) · Not Found (#718096)
- 32px bold number, 13px label, white text

**B) Checking-1 Result table**
- Title left, "⬇ Export to Excel" green outline button right
- Columns (exact): Sl No | Item Code (DWG) | Item Code (ERP) | Dwg No | Short Name (ERP) | Qty (DWG) | Qty (ERP) | Status
- Row left-border + bg by status (MATCH green, MISMATCH red, MISSING IN ERP blue, EXTRA IN ERP yellow)
- Mismatched Dwg No or Qty cells highlighted red (#FED7D7 / #C53030 bold)
- Status pills with exact specified colors

## Core Logic (all in browser)

**ERP Excel parsing (SheetJS)**
- Read first sheet as 2D array, scan for header row containing "ITEM CODE"
- Map by keyword: sl/sl no, bom level, item code, short name, qty
- Skip rows with empty itemCode → `erpData[]`

**PDF Drawing parsing (pdfjs-dist)**
- Render text content of all pages, group by Y (±3px tol), sort by X
- Locate BOM table via "BILL OF MATERIAL" / "DRG.NO" + "ITEM CODE" header
- Extract data rows (above header in this drawing format)
- Validate each row:
  - PART.NO `/^\d{1,2}$/`
  - ITEM CODE `/^[A-Z][0-9]{7,9}$/i`
  - QTY `/^\d{1,3}$/` (no decimals)
  - DRG.NO non-empty
  - Skip header keywords
- Increment `notReadableCount` for invalid rows
- Extract Level-1 assembly from title block (ITEM CODE + DRG.NO regex), prepend as slNo:1, bomLevel:1
- Output `dwgData[]`

**Comparison engine**
- Mapping (locked): Item Code DWG ↔ Item Code ERP (key); Dwg No ↔ Short Name (ERP); Qty (DWG) ↔ Qty (ERP)
- Build erpMap by uppercased itemCode
- For each dwg row → MATCH / MISMATCH / MISSING IN ERP, with `nameMismatch`/`qtyMismatch` flags
- For ERP rows not seen → EXTRA IN ERP
- Summary: total = dwgData.length, matched, mismatched, notReadable, notFound

**Export**
- SheetJS `json_to_sheet` with the 8 exact headers, auto column widths, filename `Checking1_Result_<timestamp>.xlsx`

## State (single page)
`erpFile, dwgFile, erpData, dwgData, erpUploading, dwgUploading, erpError, dwgError, erpPreviewOpen, notReadableCount, comparing, results, summary` — Reset clears all.

## Strict Rules Honored
- No mock/demo data; no ITEM/PART NUMBER/DESCRIPTION columns; no drawing preview table
- Status strings exactly: MATCH, MISMATCH, MISSING IN ERP, EXTRA IN ERP
- Exact column names in both ERP preview and Checking-1 result

## Tech
- TanStack Start (existing) + Tailwind v4 + shadcn/ui primitives where helpful (Card, Button, Table, Alert, Badge)
- Dependencies to add: `xlsx`, `pdfjs-dist`, `react-dropzone`
- 100% client-side — no backend, no database

## Error Messages
- ERP fail: "Could not read Excel file. Ensure columns include: Item Code, Short Name, Qty, BOM Level"
- PDF 0 rows: "No valid BOM table found in PDF. Ensure drawing has a BOM table with: DRG.NO, ITEM CODE, QTY (NOS.) columns and item codes like G00211094 (letter + 8 digits)"
- Run without files: "Please upload both ERP BOM Excel and Engineering Drawing PDF before running comparison"

## File Structure
- `src/routes/index.tsx` — page composition + state + handlers
- `src/components/bom/UploadCard.tsx` — generic upload card (color theme prop)
- `src/components/bom/ErpPreviewTable.tsx` — collapsible preview
- `src/components/bom/SummaryCards.tsx` — 5 stat cards
- `src/components/bom/ResultsTable.tsx` — Checking-1 table with row/cell styling and status pills
- `src/lib/bom/parseErp.ts` — SheetJS Excel parser
- `src/lib/bom/parsePdf.ts` — PDF.js extraction + validation rules
- `src/lib/bom/compare.ts` — `runChecking1` engine
- `src/lib/bom/exportExcel.ts` — SheetJS export
- `src/lib/bom/types.ts` — shared types
