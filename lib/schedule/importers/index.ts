import { parseMsProjectXml } from "./msproject";
import { parseP6Xml } from "./p6Xml";
import { parseP6Xer } from "./p6Xer";
import { parseCsv } from "./csv";
import { parseXlsx } from "./xlsx";
import { ImportError, type ImportResult } from "../types";

export async function importScheduleFile(file: File): Promise<ImportResult> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) {
    return parseCsv(await file.text());
  }
  if (name.endsWith(".xer")) {
    return parseP6Xer(await file.text());
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    return parseXlsx(await file.arrayBuffer());
  }
  if (name.endsWith(".xml")) {
    const text = await file.text();
    if (text.includes("<Project") && text.includes("xmlns") && text.includes("microsoft")) {
      return parseMsProjectXml(text);
    }
    if (text.includes("APIBusinessObjects") || text.includes("<Activity")) {
      return parseP6Xml(text);
    }
    // fallback: try MS Project then P6
    try {
      return parseMsProjectXml(text);
    } catch {
      return parseP6Xml(text);
    }
  }
  throw new ImportError(
    "Formato não suportado. Use .xml (MS Project / P6), .xer, .csv ou .xlsx"
  );
}

export {
  parseMsProjectXml,
  parseP6Xml,
  parseP6Xer,
  parseCsv,
  parseXlsx,
  ImportError,
};
