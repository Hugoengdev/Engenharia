import * as XLSX from "xlsx";
import { rowsToResult } from "./csv";
import { ImportError, type ImportResult } from "../types";

export function listXlsxSheets(buffer: ArrayBuffer): string[] {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  return wb.SheetNames.filter((n) => !!wb.Sheets[n]);
}

export function parseXlsxSheet(
  buffer: ArrayBuffer,
  sheetName: string
): ImportResult {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = wb.Sheets[sheetName];
  if (!sheet) {
    throw new ImportError(`Aba '${sheetName}' não encontrada na planilha`);
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
    raw: false,
    defval: "",
  });
  if (rows.length === 0) {
    throw new ImportError(`Aba '${sheetName}' está vazia`);
  }
  return rowsToResult(rows, "xlsx");
}

export function parseXlsx(buffer: ArrayBuffer): ImportResult {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) throw new ImportError("Planilha vazia");
  return parseXlsxSheet(buffer, firstSheetName);
}
