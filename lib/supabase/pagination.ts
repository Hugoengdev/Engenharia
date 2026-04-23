import type { PostgrestError } from "@supabase/supabase-js";

/**
 * PostgREST (Supabase) caps a single `.select()` at the project's
 * `db-max-rows` setting — 1000 rows by default. Any project with a
 * schedule larger than that needs explicit paging, otherwise the
 * server silently truncates the response.
 *
 * Usage:
 *
 *   const tasks = await fetchAllRows<TaskRow>((from, to) =>
 *     supabase
 *       .from("tasks")
 *       .select("*")
 *       .eq("schedule_id", sid)
 *       .order("sort_order", { ascending: true })
 *       .range(from, to)
 *   );
 *
 * The callback must accept inclusive `from`/`to` indices and return
 * something awaitable that resolves to `{ data, error }`. We stop
 * as soon as a page returns fewer rows than the page size.
 */
export async function fetchAllRows<T>(
  build: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  pageSize = 1000
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  // Hard ceiling as a safety net (10M rows) so a misbehaving callback
  // that always returns a full page doesn't loop forever.
  for (let guard = 0; guard < 10_000; guard++) {
    const to = from + pageSize - 1;
    const { data, error } = await build(from, to);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
    from += pageSize;
  }
  return out;
}

/**
 * Insert a list of rows in chunks so we don't trip the PostgREST
 * payload/row limits. Returns the concatenated list of inserted rows
 * (equivalent to `.insert(rows).select("*")` but safe for >1000).
 */
export async function chunkedInsert<Row, Out>(
  run: (
    rows: Row[]
  ) => PromiseLike<{ data: Out[] | null; error: PostgrestError | null }>,
  rows: Row[],
  chunkSize = 500
): Promise<Out[]> {
  const out: Out[] = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = rows.slice(i, i + chunkSize);
    const { data, error } = await run(slice);
    if (error) throw error;
    if (data) out.push(...data);
  }
  return out;
}
