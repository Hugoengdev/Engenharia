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
  // `raw: true` + `cellDates: true` makes xlsx return Date objects for
  // date-formatted cells and numbers for numeric cells — this is much more
  // reliable than letting xlsx format them as strings with the system locale
  // (which silently produces "8/15/25" vs "15/08/2025" depending on the
  // user's machine). Our `toIsoDate` handles Date / number / string.
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    raw: true,
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
