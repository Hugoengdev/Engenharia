export interface NormalizedTask {
  external_id: string | null;
  wbs: string | null;
  /**
   * Physical location / zone where the activity happens (e.g. "Pavimento 3").
   * Distinct from `wbs` (hierarchical breakdown). `null` when the source file
   * doesn't carry a location column.
   */
  location: string | null;
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

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Convert a raw cell value to an ISO date (YYYY-MM-DD).
 *
 * We handle Date objects and Excel-serial numbers (when the caller passes
 * `raw: true`), ISO strings, and Brazilian `DD/MM/YYYY` strings — which is
 * the natural format users type in Excel in pt-BR. We deliberately read
 * local components instead of `toISOString()` so a Date built from local
 * midnight (which Excel/XLSX does) doesn't shift to the previous day in
 * negative UTC offsets.
 */
export function toIsoDate(
  input: string | number | Date | null | undefined
): string {
  if (input === null || input === undefined || input === "") {
    throw new ImportError("Data ausente");
  }
  if (input instanceof Date) {
    if (isNaN(input.getTime())) throw new ImportError("Data inválida");
    return `${input.getFullYear()}-${pad2(input.getMonth() + 1)}-${pad2(
      input.getDate()
    )}`;
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    // ISO YYYY-MM-DD (optionally followed by time) — take the date part.
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    // Brazilian / European DD/MM/YYYY (accept -, / or . as separators,
    // 2- or 4-digit year). 2-digit years follow the common convention:
    // 70-99 → 19xx, 00-69 → 20xx.
    const br = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(trimmed);
    if (br) {
      const [, d, m, yRaw] = br;
      const year =
        yRaw.length === 2
          ? parseInt(yRaw, 10) >= 70
            ? `19${yRaw}`
            : `20${yRaw}`
          : yRaw;
      return `${year}-${pad2(Number(m))}-${pad2(Number(d))}`;
    }
  }
  const d = new Date(input as string | number);
  if (isNaN(d.getTime())) throw new ImportError(`Data inválida: ${input}`);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function diffDays(start: string, end: string): number {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  return Math.max(1, Math.round((e - s) / (1000 * 60 * 60 * 24)));
}
