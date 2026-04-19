import type { NormalizedTask } from "@/lib/schedule/types";

/**
 * Signature of a task used to match the "same" task across two
 * schedule imports (re-imports). We match ONLY by stable IDs:
 *   - external_id (MS Project UID / P6 activity id)
 *   - sort_order  (row ID in the imported file)
 * Name and WBS are intentionally ignored — those change freely
 * between revisions and would produce false matches.
 */
export interface OldTaskLike {
  id: string;
  external_id: string | null;
  sort_order: number;
}

/**
 * Matches each task in `newTasks` against the old schedule by stable IDs,
 * returning the matched old task (or `null`) for each new task.
 *
 * Matching priority (first hit wins):
 *   1. external_id (non-null + exact match)
 *   2. sort_order  (same row ID on both sides)
 *
 * Each old task is consumed at most once so a single task on the old
 * schedule does not leak into multiple rows on the new one.
 *
 * @returns Array parallel to `newTasks` where element i is the matched
 *          old task (or null if no match).
 */
export function matchTasksByStableId<T extends OldTaskLike>(
  oldTasks: T[],
  newTasks: NormalizedTask[]
): (T | null)[] {
  const byExternal = new Map<string, T[]>();
  const bySort = new Map<number, T[]>();

  const push = <K>(map: Map<K, T[]>, key: K, t: T) => {
    const arr = map.get(key);
    if (arr) arr.push(t);
    else map.set(key, [t]);
  };

  for (const t of oldTasks) {
    if (t.external_id) push(byExternal, t.external_id, t);
    push(bySort, t.sort_order, t);
  }

  const consumed = new Set<string>();

  function take(candidates: T[] | undefined): T | null {
    if (!candidates) return null;
    for (const c of candidates) {
      if (!consumed.has(c.id)) {
        consumed.add(c.id);
        return c;
      }
    }
    return null;
  }

  return newTasks.map((nt) => {
    let matched: T | null = null;
    if (nt.external_id) matched = take(byExternal.get(nt.external_id));
    if (!matched) matched = take(bySort.get(nt.sort_order));
    return matched;
  });
}

/**
 * Convenience wrapper: given matched old tasks and the list of old links,
 * returns an array parallel to `newTasks` with the ifc_global_ids that
 * should carry over to each new task.
 */
export function preservedLinksFromMatches<T extends OldTaskLike>(
  matches: (T | null)[],
  oldLinks: { task_id: string; ifc_global_id: string }[]
): string[][] {
  const linksByOldId = new Map<string, string[]>();
  for (const l of oldLinks) {
    const arr = linksByOldId.get(l.task_id);
    if (arr) arr.push(l.ifc_global_id);
    else linksByOldId.set(l.task_id, [l.ifc_global_id]);
  }
  return matches.map((m) => (m ? (linksByOldId.get(m.id) ?? []) : []));
}
