import { XMLParser } from "fast-xml-parser";
import {
  type ImportResult,
  type NormalizedTask,
  ImportError,
  toIsoDate,
  diffDays,
} from "../types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  parseTagValue: false,
});

/**
 * Primavera P6 PMXML structure (simplified):
 *   <APIBusinessObjects>
 *     <Project>
 *       <Activity>
 *         <Id>...</Id>
 *         <Name>...</Name>
 *         <StartDate>...</StartDate>
 *         <FinishDate>...</FinishDate>
 *         <PercentComplete>...</PercentComplete>
 *         <WBSObjectId>...</WBSObjectId>
 *       </Activity>
 *       <Relationship>
 *         <PredecessorActivityObjectId>...</PredecessorActivityObjectId>
 *         <SuccessorActivityObjectId>...</SuccessorActivityObjectId>
 *       </Relationship>
 *     </Project>
 *   </APIBusinessObjects>
 */
export function parseP6Xml(xml: string): ImportResult {
  const data = parser.parse(xml) as Record<string, unknown>;
  const root = (data.APIBusinessObjects ?? data) as Record<string, unknown>;
  const project = root.Project as Record<string, unknown> | undefined;
  if (!project) {
    throw new ImportError("Não parece um arquivo P6 PMXML válido (sem <Project>)");
  }

  const activitiesNode = project.Activity as
    | Record<string, unknown>
    | Record<string, unknown>[]
    | undefined;
  if (!activitiesNode) {
    throw new ImportError("Nenhuma <Activity> encontrada no XML do P6");
  }
  const activities = Array.isArray(activitiesNode) ? activitiesNode : [activitiesNode];

  const relationshipsNode = project.Relationship as
    | Record<string, unknown>
    | Record<string, unknown>[]
    | undefined;
  const relationships = relationshipsNode
    ? Array.isArray(relationshipsNode)
      ? relationshipsNode
      : [relationshipsNode]
    : [];

  const succToPreds = new Map<string, string[]>();
  for (const r of relationships) {
    const pred = String(r.PredecessorActivityObjectId ?? "");
    const succ = String(r.SuccessorActivityObjectId ?? "");
    if (!pred || !succ) continue;
    if (!succToPreds.has(succ)) succToPreds.set(succ, []);
    succToPreds.get(succ)!.push(pred);
  }

  const out: NormalizedTask[] = activities.map((a, idx) => {
    const start = toIsoDate(String(a.StartDate ?? a.PlannedStartDate ?? ""));
    const end = toIsoDate(String(a.FinishDate ?? a.PlannedFinishDate ?? ""));
    const id = String(a.ObjectId ?? a.Id ?? idx);

    // Prefer the BaselineStart/BaselineFinish nodes when present; fall
    // back to PlannedStart/PlannedFinish (which in P6 represent the
    // original plan before the schedule was accepted). If neither is
    // present we return null and let the caller decide.
    let baseline_start: string | null = null;
    let baseline_end: string | null = null;
    const blStart =
      a.BaselineStartDate ?? a.BaselineStart ?? a.PlannedStartDate;
    const blEnd =
      a.BaselineFinishDate ?? a.BaselineFinish ?? a.PlannedFinishDate;
    if (blStart && String(blStart) !== String(a.StartDate ?? "")) {
      try {
        baseline_start = toIsoDate(String(blStart));
      } catch {
        /* ignore */
      }
    }
    if (blEnd && String(blEnd) !== String(a.FinishDate ?? "")) {
      try {
        baseline_end = toIsoDate(String(blEnd));
      } catch {
        /* ignore */
      }
    }

    return {
      external_id: id,
      wbs: a.WBSObjectId ? String(a.WBSObjectId) : null,
      name: String(a.Name ?? a.Id ?? "Atividade sem nome"),
      start_date: start,
      end_date: end,
      baseline_start,
      baseline_end,
      duration_days: diffDays(start, end),
      progress: Number(a.PercentComplete ?? 0),
      predecessors: succToPreds.get(id) ?? [],
      parent_external_id: a.WBSObjectId ? String(a.WBSObjectId) : null,
      sort_order: idx,
    };
  });

  if (out.length === 0) throw new ImportError("Nenhuma atividade válida encontrada");

  return { source_type: "p6_xml", tasks: out };
}
