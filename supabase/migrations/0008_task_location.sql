-- Location (Local) column for each task.
-- Different from `wbs` (which is the hierarchical breakdown): this field
-- holds the physical place the activity happens (e.g. "Pavimento 3",
-- "Bloco A", "Torre Sul"). Imported from the "Local" column of the Excel
-- planning sheets.

alter table public.tasks
    add column if not exists location text;

comment on column public.tasks.location is
    'Physical location / zone where the activity is executed. Imported from the "Local" column of the schedule spreadsheet. Free text, nullable.';
