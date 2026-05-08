export interface ErpRow {
  slNo: string | number;
  bomLevel: string | number;
  itemCode: string;
  shortName: string;
  qty: string | number;
}

export interface DwgRow {
  slNo: number;
  bomLevel: number;
  itemCode: string; // may be "—" for rows without item code (e.g., NUT, BOLT)
  dwgNo: string;
  qty: number; // effective qty (multiplied through parents) - used for compare
  dwgQty?: number; // raw qty as written in the drawing BOM
  parentQty?: number; // parent's effective qty used in multiplication
  parentItemCode: string | null;
}

export type Status =
  | "MATCH"
  | "MISMATCH"
  | "MISSING IN ERP"
  | "EXTRA IN ERP"
  | "NO CODE";

export interface ResultRow {
  slNo: number;
  bomLevel: number | string;
  parentItemCode: string | null;
  itemCodeDwg: string;
  itemCodeErp: string;
  dwgNo: string;
  shortNameErp: string;
  qtyDwg: string | number;
  qtyErp: string | number;
  bomLevelErp: string | number;
  status: Status;
  levelMismatch: boolean;
  nameMismatch: boolean;
  qtyMismatch: boolean;
}

export interface Summary {
  total: number;
  matched: number;
  mismatched: number;
  notReadable: number;
  notFound: number;
}
