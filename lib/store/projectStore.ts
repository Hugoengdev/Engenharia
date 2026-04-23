"use client";

import { create } from "zustand";
import type { TaskRow } from "@/lib/supabase/types";

export type TaskWithLinks = TaskRow & { ifc_global_ids: string[] };

export type TaskStatus = "not_started" | "in_progress" | "done";

interface ProjectState {
  projectId: string | null;
  scheduleId: string | null;
  tasks: TaskWithLinks[];
  selectedTaskId: string | null;
  selectedGlobalIds: string[];
  /** Status date / data-base of the schedule (YYYY-MM-DD). */
  statusDate: Date | null;
  currentDate: Date | null;
  isPlaying: boolean;
  playSpeed: number;

  setProjectMeta: (projectId: string, scheduleId: string | null) => void;
  setTasks: (tasks: TaskWithLinks[]) => void;
  upsertTask: (task: TaskWithLinks) => void;
  removeTask: (id: string) => void;
  setSelectedTask: (id: string | null) => void;
  setSelectedGlobalIds: (ids: string[]) => void;
  setLinksForTask: (taskId: string, ids: string[]) => void;
  setStatusDate: (date: Date | null) => void;
  setCurrentDate: (date: Date) => void;
  setPlaying: (v: boolean) => void;
  setPlaySpeed: (v: number) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projectId: null,
  scheduleId: null,
  tasks: [],
  selectedTaskId: null,
  selectedGlobalIds: [],
  statusDate: null,
  currentDate: null,
  isPlaying: false,
  playSpeed: 1,

  setProjectMeta: (projectId, scheduleId) =>
    set({ projectId, scheduleId, tasks: [] }),
  setTasks: (tasks) => set({ tasks }),
  upsertTask: (task) =>
    set((s) => {
      const idx = s.tasks.findIndex((t) => t.id === task.id);
      if (idx === -1) return { tasks: [...s.tasks, task] };
      const next = s.tasks.slice();
      next[idx] = task;
      return { tasks: next };
    }),
  removeTask: (id) =>
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
  setSelectedTask: (id) => set({ selectedTaskId: id }),
  setSelectedGlobalIds: (ids) => set({ selectedGlobalIds: ids }),
  setLinksForTask: (taskId, ids) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === taskId ? { ...t, ifc_global_ids: ids } : t
      ),
    })),
  setStatusDate: (date) => set({ statusDate: date }),
  setCurrentDate: (date) => set({ currentDate: date }),
  setPlaying: (v) => set({ isPlaying: v }),
  setPlaySpeed: (v) => set({ playSpeed: v }),
}));

/**
 * Classify a task against the simulation date. The 4D timeline is driven by
 * the CURRENT/forecast dates (the "trend") — i.e. start_date / end_date —
 * so the model reflects what's actually happening in the field. The
 * baseline end is kept only to decide, once a task is done, whether it
 * turns green (ended on or before baseline_end) or red (ended after
 * baseline_end). All four date fields are never-null (enforced by the DB
 * schema).
 */
export function classifyTask(task: TaskRow, current: Date): TaskStatus {
  const start = new Date(task.start_date);
  const end = new Date(task.end_date);
  if (current < start) return "not_started";
  if (current >= end) return "done";
  return "in_progress";
}

/**
 * Positive days => task is late (forecast end_date is after baseline_end).
 * Negative days => task is ahead of plan. Zero means "on time".
 */
export function taskDelayDays(task: TaskRow): number {
  const baseline = new Date(task.baseline_end).getTime();
  const forecast = new Date(task.end_date).getTime();
  return Math.round((forecast - baseline) / (1000 * 60 * 60 * 24));
}

export type DelayStatus = "on_time" | "delayed";

export function taskDelayStatus(task: TaskRow): DelayStatus {
  return taskDelayDays(task) > 0 ? "delayed" : "on_time";
}

/**
 * Bounds of the 4D playback window. Based on BASELINE dates (the plan).
 */
export function scheduleBounds(
  tasks: TaskRow[]
): { min: Date; max: Date } | null {
  if (tasks.length === 0) return null;
  let min = new Date(tasks[0].baseline_start).getTime();
  let max = new Date(tasks[0].baseline_end).getTime();
  for (const t of tasks) {
    const s = new Date(t.baseline_start).getTime();
    const e = new Date(t.baseline_end).getTime();
    if (s < min) min = s;
    if (e > max) max = e;
  }
  return { min: new Date(min), max: new Date(max) };
}
