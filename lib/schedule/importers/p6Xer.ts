import {
  type ImportResult,
  type NormalizedTask,
  ImportError,
  toIsoDate,
  diffDays,
} from "../types";

/**
 * Primavera XER (text format):
 *   ERMHDR\t...
 *   %T\tTABLE_NAME
 *   %F\tcol1\tcol2\t...
 *   %R\tval1\tval2\t...
 *   %R\t...
 *
 * We care about TASK and TASKPRED tables.
 */
interface XerTable {
  fields: string[];
  rows: Record<string, string>[];
}

function parseXerTables(content: string): Map<string, XerTable> {
  const tables = new Map<string, XerTable>();
  const lines = content.split(/\r?\n/);
  let current: { name: string; fields: string[]; rows: Record<string, string>[] } | null = null;

  for (const line of lines) {
    if (!line) continue;
    const cols = line.split("\t");
    const tag = cols[0];
    if (tag === "%T") {
      if (current) {
        tables.set(current.name, { fields: current.fields, rows: current.rows });
      }
      current = { name: cols[1], fields: [], rows: [] };
    } else if (tag === "%F" && current) {
      current.fields = cols.slice(1);
    } else if (tag === "%R" && current) {
      const values = cols.slice(1);
      const row: Record<string, string> = {};
      current.fields.forEach((f, i) => {
        row[f] = values[i] ?? "";
      });
      current.rows.push(row);
    } else if (tag === "%E") {
      if (current) {
        tables.set(current.name, { fields: current.fields, rows: current.rows });
        current = null;
      }
    }
  }
  if (current) tables.set(current.name, { fields: current.fields, rows: current.rows });
  return tables;
}

export function parseP6Xer(content: string): ImportResult {
  if (!content.startsWith("ERMHDR")) {
    throw new ImportError("Arquivo XER inválido: cabeçalho ERMHDR ausente");
  }
  const tables = parseXerTables(content);
  const taskTable = tables.get("TASK");
  if (!taskTable) throw new ImportError("Tabela TASK não encontrada no XER");

  const predTable = tables.get("TASKPRED");
  const succToPreds = new Map<string, string[]>();
  if (predTable) {
    for (const r of predTable.rows) {
      const succ = r.task_id;
      const pred = r.pred_task_id;
      if (!succ || !pred) continue;
      if (!succToPreds.has(succ)) succToPreds.set(succ, []);
      succToPreds.get(succ)!.push(pred);
    }
  }

  const out: NormalizedTask[] = taskTable.rows.map((r, idx) => {
    const startSrc =
      r.act_start_date || r.target_start_date || r.early_start_date;
    const endSrc =
      r.act_end_date || r.target_end_date || r.early_end_date;
    if (!startSrc || !endSrc) {
      throw new ImportError(`Tarefa ${r.task_id} sem datas de início/fim`);
    }
    const start = toIsoDate(startSrc);
    const end = toIsoDate(endSrc);

    // In Primavera the "target" dates represent the originally planned
    // schedule, which is the closest thing XER carries to a baseline.
    // Prefer that when the row actually exposes them; otherwise leave
    // baseline as null and let the caller decide how to fill in.
    let baseline_start: string | null = null;
    let baseline_end: string | null = null;
    try {
      if (r.target_start_date) baseline_start = toIsoDate(r.target_start_date);
    } catch {
      /* ignore */
    }
    try {
      if (r.target_end_date) baseline_end = toIsoDate(r.target_end_date);
    } catch {
      /* ignore */
    }

    return {
      external_id: r.task_id,
      wbs: r.wbs_id || null,
      location: null,
      name: r.task_name || r.task_code || "Atividade sem nome",
      start_date: start,
      end_date: end,
      baseline_start,
      baseline_end,
      duration_days: diffDays(start, end),
      progress: Number(r.phys_complete_pct ?? 0),
      predecessors: succToPreds.get(r.task_id) ?? [],
      parent_external_id: r.wbs_id || null,
      sort_order: idx,
    };
  });

  if (out.length === 0) throw new ImportError("Nenhuma tarefa válida encontrada no XER");

  return { source_type: "p6_xer", tasks: out };
}
