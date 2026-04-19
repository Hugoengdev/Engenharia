import * as XLSX from "xlsx";
import { rowsToResult } from "./csv";
import type { ImportResult } from "../types";

export function parseXlsx(buffer: ArrayBuffer): ImportResult {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) throw new Error("Planilha vazia");
  const sheet = wb.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
    raw: false,
    defval: "",
  });
  return rowsToResult(rows, "xlsx");
}
