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

interface MspBaselineNode {
  Start?: string;
  Finish?: string;
  Number?: string;
}

interface MspTaskNode {
  UID?: string;
  ID?: string;
  Name?: string;
  WBS?: string;
  Start?: string;
  Finish?: string;
  Duration?: string;
  PercentComplete?: string;
  OutlineLevel?: string;
  PredecessorLink?:
    | { PredecessorUID?: string }
    | { PredecessorUID?: string }[];
  Summary?: string;
  // Baseline0..Baseline10 in MS Project XML are nested as <Baseline>
  // children with <Number> indicating which one it is. We only look at
  // the first one (Number=0) since that's the one the user normally saves.
  Baseline?: MspBaselineNode | MspBaselineNode[];
}

export function parseMsProjectXml(xml: string): ImportResult {
  const data = parser.parse(xml) as Record<string, unknown>;
  const project = (data.Project ?? data.project) as
    | Record<string, unknown>
    | undefined;
  if (!project) {
    throw new ImportError("Não parece um arquivo MS Project XML válido (sem <Project>)");
  }
  const tasksNode = project.Tasks as { Task?: MspTaskNode | MspTaskNode[] } | undefined;
  if (!tasksNode?.Task) {
    throw new ImportError("Nenhuma tarefa encontrada no XML");
  }
  const rawTasks = Array.isArray(tasksNode.Task) ? tasksNode.Task : [tasksNode.Task];

  const stack: { uid: string; level: number }[] = [];
  const out: NormalizedTask[] = [];

  rawTasks.forEach((t, idx) => {
    if (!t.Name || !t.Start || !t.Finish) return;
    if (t.Summary === "1") {
      // Skip pure summary nodes from becoming tasks (could be enabled later)
    }
    const level = Number(t.OutlineLevel ?? 1);
    while (stack.length && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    const parentUid = stack.length ? stack[stack.length - 1].uid : null;

    const start = toIsoDate(t.Start);
    const end = toIsoDate(t.Finish);
    const externalId = String(t.UID ?? t.ID ?? idx);

    // Look for a <Baseline> child (prefer Number=0) so we surface the
    // schedule baseline the user saved in MS Project. Multiple baselines
    // (Baseline0..Baseline10) live as an array; we pick the saved one.
    let baseline_start: string | null = null;
    let baseline_end: string | null = null;
    if (t.Baseline) {
      const baselines = Array.isArray(t.Baseline) ? t.Baseline : [t.Baseline];
      const chosen =
        baselines.find((b) => String(b?.Number ?? "0") === "0") ??
        baselines[0];
      if (chosen) {
        try {
          if (chosen.Start) baseline_start = toIsoDate(chosen.Start);
        } catch {
          /* ignore */
        }
        try {
          if (chosen.Finish) baseline_end = toIsoDate(chosen.Finish);
        } catch {
          /* ignore */
        }
      }
    }

    const predLinks = t.PredecessorLink
      ? Array.isArray(t.PredecessorLink)
        ? t.PredecessorLink
        : [t.PredecessorLink]
      : [];

    out.push({
      external_id: externalId,
      wbs: t.WBS ?? null,
      name: t.Name,
      start_date: start,
      end_date: end,
      baseline_start,
      baseline_end,
      duration_days: diffDays(start, end),
      progress: Number(t.PercentComplete ?? 0),
      predecessors: predLinks
        .map((p) => p.PredecessorUID)
        .filter((x): x is string => !!x),
      parent_external_id: parentUid,
      sort_order: idx,
    });

    stack.push({ uid: externalId, level });
  });

  if (out.length === 0) {
    throw new ImportError("Nenhuma tarefa válida encontrada");
  }

  return { source_type: "msproject_xml", tasks: out };
}
