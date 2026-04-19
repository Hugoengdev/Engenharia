import type { TaskRow } from "@/lib/supabase/types";
import type { TaskWithLinks } from "@/lib/store/projectStore";

export function adaptTasks(
  rows: TaskRow[],
  links: { task_id: string; ifc_global_id: string }[]
): TaskWithLinks[] {
  const map = new Map<string, string[]>();
  for (const l of links) {
    if (!map.has(l.task_id)) map.set(l.task_id, []);
    map.get(l.task_id)!.push(l.ifc_global_id);
  }
  return rows.map((t) => ({
    ...t,
    ifc_global_ids: map.get(t.id) ?? [],
  })) as TaskWithLinks[];
}
