-- Adds a "status date" (data-base) to each schedule.
-- Activities fully completed before this date are considered done
-- when the 4D timeline initializes, and the timeline starts scrolling
-- from this date onwards.

alter table public.schedules
    add column if not exists status_date date;

comment on column public.schedules.status_date is
    'Reference (data-base) date for the schedule. Tasks ending before this date are treated as already completed by the 4D timeline.';
