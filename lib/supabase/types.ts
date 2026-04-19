export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ScheduleSource =
  | "manual"
  | "msproject_xml"
  | "p6_xml"
  | "p6_xer"
  | "csv"
  | "xlsx";

export interface Database {
  __InternalSupabase: {
    PostgrestVersion: "12";
  };
  public: {
    Tables: {
      projects: {
        Row: {
          id: string;
          owner_id: string | null;
          name: string;
          description: string | null;
          ifc_path: string | null;
          ifc_filename: string | null;
          ifc_size_bytes: number | null;
          ifc_storage: "supabase" | "github" | null;
          ifc_release_id: number | null;
          ifc_asset_id: number | null;
          ifc_asset_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id?: string | null;
          name: string;
          description?: string | null;
          ifc_path?: string | null;
          ifc_filename?: string | null;
          ifc_size_bytes?: number | null;
          ifc_storage?: "supabase" | "github" | null;
          ifc_release_id?: number | null;
          ifc_asset_id?: number | null;
          ifc_asset_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string | null;
          name?: string;
          description?: string | null;
          ifc_path?: string | null;
          ifc_filename?: string | null;
          ifc_size_bytes?: number | null;
          ifc_storage?: "supabase" | "github" | null;
          ifc_release_id?: number | null;
          ifc_asset_id?: number | null;
          ifc_asset_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      schedules: {
        Row: {
          id: string;
          project_id: string;
          source_type: ScheduleSource;
          imported_at: string;
          status_date: string | null;
        };
        Insert: {
          id?: string;
          project_id: string;
          source_type: ScheduleSource;
          imported_at?: string;
          status_date?: string | null;
        };
        Update: {
          id?: string;
          project_id?: string;
          source_type?: ScheduleSource;
          imported_at?: string;
          status_date?: string | null;
        };
        Relationships: [];
      };
      tasks: {
        Row: {
          id: string;
          schedule_id: string;
          external_id: string | null;
          wbs: string | null;
          name: string;
          start_date: string;
          end_date: string;
          baseline_start: string;
          baseline_end: string;
          duration_days: number | null;
          progress: number;
          parent_id: string | null;
          predecessors: Json;
          color: string | null;
          sort_order: number;
        };
        Insert: {
          id?: string;
          schedule_id: string;
          external_id?: string | null;
          wbs?: string | null;
          name: string;
          start_date: string;
          end_date: string;
          baseline_start: string;
          baseline_end: string;
          duration_days?: number | null;
          progress?: number;
          parent_id?: string | null;
          predecessors?: Json;
          color?: string | null;
          sort_order?: number;
        };
        Update: {
          id?: string;
          schedule_id?: string;
          external_id?: string | null;
          wbs?: string | null;
          name?: string;
          start_date?: string;
          end_date?: string;
          baseline_start?: string;
          baseline_end?: string;
          duration_days?: number | null;
          progress?: number;
          parent_id?: string | null;
          predecessors?: Json;
          color?: string | null;
          sort_order?: number;
        };
        Relationships: [];
      };
      task_elements: {
        Row: {
          task_id: string;
          ifc_global_id: string;
        };
        Insert: {
          task_id: string;
          ifc_global_id: string;
        };
        Update: {
          task_id?: string;
          ifc_global_id?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}

export type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];
export type ScheduleRow = Database["public"]["Tables"]["schedules"]["Row"];
export type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];
export type TaskElementRow =
  Database["public"]["Tables"]["task_elements"]["Row"];

/**
 * Predecessor relationship types (standard PDM notation):
 * FS = Finish-to-Start (default): successor starts after predecessor finishes.
 * SS = Start-to-Start: successor starts when predecessor starts.
 * FF = Finish-to-Finish: successor finishes when predecessor finishes.
 * SF = Start-to-Finish: successor finishes when predecessor starts (rare).
 */
export type PredecessorType = "FS" | "SS" | "FF" | "SF";

export interface Predecessor {
  task_id: string;
  type: PredecessorType;
  /** Lag in days. Negative means lead (overlap). */
  lag: number;
}

export function parsePredecessors(value: Json): Predecessor[] {
  if (!Array.isArray(value)) return [];
  const out: Predecessor[] = [];
  for (const v of value) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const r = v as Record<string, Json>;
    const id = r.task_id;
    if (typeof id !== "string" || id.length === 0) continue;
    const rawType = r.type;
    const type: PredecessorType =
      rawType === "SS" || rawType === "FF" || rawType === "SF" ? rawType : "FS";
    const lag =
      typeof r.lag === "number" && Number.isFinite(r.lag) ? r.lag : 0;
    out.push({ task_id: id, type, lag });
  }
  return out;
}

export function formatPredecessor(p: Predecessor, refLabel: string): string {
  const lag =
    p.lag > 0 ? `+${p.lag}d` : p.lag < 0 ? `${p.lag}d` : "";
  return `${refLabel}${p.type}${lag}`;
}
