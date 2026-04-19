-- Baseline (linha de base) dates for each task.
-- The 4D timeline runs on baseline dates; the elements are colored green or
-- red depending on how the forecast (start_date/end_date) compares against
-- the baseline. Existing tasks get their current dates copied into baseline
-- so nothing is flagged as delayed until the user decides otherwise.

alter table public.tasks
    add column if not exists baseline_start date,
    add column if not exists baseline_end   date;

-- Backfill existing rows where baseline is missing.
update public.tasks
set baseline_start = start_date
where baseline_start is null;

update public.tasks
set baseline_end = end_date
where baseline_end is null;

-- Enforce non-null going forward.
alter table public.tasks
    alter column baseline_start set not null,
    alter column baseline_end   set not null;

comment on column public.tasks.baseline_start is
    'Planned start date (linha de base). The 4D timeline animates by baseline dates; color compares baseline to start_date/end_date.';
comment on column public.tasks.baseline_end is
    'Planned end date (linha de base). Element turns red in 4D when end_date > baseline_end (atrasada) and green otherwise.';
