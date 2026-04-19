export interface NormalizedTask {
  external_id: string | null;
  wbs: string | null;
  name: string;
  start_date: string;
  end_date: string;
  /**
   * Baseline start/end, when the source file carries a distinct "linha base".
   * `null` means "not present in the file" — the caller decides whether to
   * fall back to the previous baseline (on re-imports) or to the forecast
   * dates (for brand new tasks).
   */
  baseline_start: string | null;
  baseline_end: string | null;
  duration_days: number | null;
  progress: number;
  predecessors: string[];
  parent_external_id: string | null;
  sort_order: number;
}

export interface ImportResult {
  source_type:
    | "msproject_xml"
    | "p6_xml"
    | "p6_xer"
    | "csv"
    | "xlsx"
    | "manual";
  tasks: NormalizedTask[];
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

export function toIsoDate(input: string | number | Date | null | undefined): string {
  if (!input) throw new ImportError("Data ausente");
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) throw new ImportError(`Data inválida: ${input}`);
  return d.toISOString().slice(0, 10);
}

export function diffDays(start: string, end: string): number {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  return Math.max(1, Math.round((e - s) / (1000 * 60 * 60 * 24)));
}
