import Papa from "papaparse";
import {
  type ImportResult,
  type NormalizedTask,
  ImportError,
  toIsoDate,
  diffDays,
} from "../types";

/**
 * Each alias here is compared after normalizing both the header and the
 * candidate via `normalizeKey()` — so "Início LB", "inicio_lb" and
 * "INICIOLB" all match "iniciolb". Keep aliases in the normalized form.
 */
const NAME_KEYS = ["name", "nome", "task", "tarefa", "atividade", "activity"];
const ID_KEYS = ["id", "uid", "externalid", "taskid"];
const START_KEYS = [
  "start",
  "startdate",
  "inicio",
  "datainicio",
  "inicioreal",
  "iniciotendencia",
  "tendenciainicio",
  "inicioprevisto",
  "begin",
];
const END_KEYS = [
  "end",
  "finish",
  "enddate",
  "fim",
  "termino",
  "datafim",
  "fimreal",
  "fimtendencia",
  "tendenciafim",
  "terminoprevisto",
  "fimprevisto",
];
// Baseline (linha base / planned) aliases. Kept separate from END/START so
// a file that carries BOTH forecast and baseline dates (which is the whole
// point of a schedule baseline) is parsed correctly.
const BASELINE_START_KEYS = [
  "baselinestart",
  "baselineinicio",
  "bllinhabaseinicio",
  "blstart",
  "startbl",
  "blinicio",
  "iniciobl",
  "inicioblinhabase",
  "iniciolinhabase",
  "linhabaseinicio",
  "datainiciobl",
  "datainiciolb",
  "lbinicio",
  "iniciolb",
  "plannedstart",
  "plannedstartdate",
  "plannedinicio",
  "inicioplanejado",
  "inicioplan",
  "planinicio",
];
const BASELINE_END_KEYS = [
  "baselineend",
  "baselinefinish",
  "baselinefim",
  "baselinetermino",
  "blend",
  "blfinish",
  "blfim",
  "bltermino",
  "endbl",
  "finishbl",
  "fimbl",
  "terminobl",
  "fimblinhabase",
  "fimlinhabase",
  "terminolinhabase",
  "linhabasefim",
  "datafimbl",
  "datafimlb",
  "lbfim",
  "fimlb",
  "plannedend",
  "plannedfinish",
  "plannedenddate",
  "plannedfinishdate",
  "plannedfim",
  "plannedtermino",
  "fimplanejado",
  "terminoplanejado",
  "fimplan",
  "terminoplan",
  "planfim",
  "plantermino",
];
const WBS_KEYS = ["wbs", "edt"];
const LOCATION_KEYS = [
  "local",
  "location",
  "zona",
  "zone",
  "area",
  "pavimento",
  "ambiente",
];
const PROGRESS_KEYS = ["progress", "progresso", "percent", "percentcomplete"];
const PRED_KEYS = ["predecessors", "predecessores", "pred"];
const PARENT_KEYS = ["parent", "parentid", "pai"];

/**
 * Normalize a header/alias for matching: strip accents, lowercase, and
 * drop any non-alphanumeric character. That way spreadsheets written as
 * "Início LB", "Inicio_LB", "inicio-lb", "INICIO LB" all collapse to the
 * same key "iniciolb".
 */
function normalizeKey(k: string): string {
  return k
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function pick(row: Record<string, string>, keys: string[]): string | null {
  const normalized: Record<string, string> = {};
  for (const k of Object.keys(row)) normalized[normalizeKey(k)] = row[k];
  for (const k of keys) {
    const v = normalized[normalizeKey(k)];
    if (v !== undefined && v !== "") return v;
  }
  return null;
}

export function parseCsv(content: string): ImportResult {
  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  if (parsed.errors.length > 0) {
    throw new ImportError(`Erro ao ler CSV: ${parsed.errors[0].message}`);
  }
  if (!parsed.data || parsed.data.length === 0) {
    throw new ImportError("CSV vazio");
  }

  return rowsToResult(parsed.data, "csv");
}

export function rowsToResult(
  rows: Record<string, string>[],
  source: "csv" | "xlsx"
): ImportResult {
  const out: NormalizedTask[] = rows.map((row, idx) => {
    const name = pick(row, NAME_KEYS);
    const start = pick(row, START_KEYS);
    const end = pick(row, END_KEYS);
    if (!name || !start || !end) {
      throw new ImportError(
        `Linha ${idx + 2}: colunas obrigatórias 'name', 'start' e 'end' são necessárias`
      );
    }
    const startIso = toIsoDate(start);
    const endIso = toIsoDate(end);

    // Baseline / linha base / planned is optional. When it IS present in
    // the file, parse and keep it distinct from the forecast dates — the
    // dialog consumer is in charge of deciding what to do if it's null.
    const baselineStartRaw = pick(row, BASELINE_START_KEYS);
    const baselineEndRaw = pick(row, BASELINE_END_KEYS);
    let baseline_start: string | null = null;
    let baseline_end: string | null = null;
    if (baselineStartRaw) {
      try {
        baseline_start = toIsoDate(baselineStartRaw);
      } catch {
        // Leave null if the cell is not a parseable date.
      }
    }
    if (baselineEndRaw) {
      try {
        baseline_end = toIsoDate(baselineEndRaw);
      } catch {
        // Leave null if the cell is not a parseable date.
      }
    }

    const predRaw = pick(row, PRED_KEYS);
    const predecessors = predRaw
      ? predRaw
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    return {
      external_id: pick(row, ID_KEYS) ?? String(idx + 1),
      wbs: pick(row, WBS_KEYS),
      location: pick(row, LOCATION_KEYS),
      name,
      start_date: startIso,
      end_date: endIso,
      baseline_start,
      baseline_end,
      duration_days: diffDays(startIso, endIso),
      progress: Number(pick(row, PROGRESS_KEYS) ?? 0),
      predecessors,
      parent_external_id: pick(row, PARENT_KEYS),
      sort_order: idx,
    };
  });

  return { source_type: source, tasks: out };
}
