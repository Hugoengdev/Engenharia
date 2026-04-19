-- BIM 4D — initial schema
-- Tables: projects, schedules, tasks, task_elements
-- Storage bucket: ifc-files (private, owner-only access)

create extension if not exists "pgcrypto";

-- =========================================================================
-- projects
-- =========================================================================
create table if not exists public.projects (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    description text,
    ifc_path text,
    ifc_filename text,
    ifc_size_bytes bigint,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists projects_owner_id_idx on public.projects (owner_id);

-- =========================================================================
-- schedules
-- =========================================================================
create table if not exists public.schedules (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references public.projects(id) on delete cascade,
    source_type text not null check (
        source_type in ('manual','msproject_xml','p6_xml','p6_xer','csv','xlsx')
    ),
    imported_at timestamptz not null default now()
);

create index if not exists schedules_project_id_idx on public.schedules (project_id);

-- =========================================================================
-- tasks
-- =========================================================================
create table if not exists public.tasks (
    id uuid primary key default gen_random_uuid(),
    schedule_id uuid not null references public.schedules(id) on delete cascade,
    external_id text,
    wbs text,
    name text not null,
    start_date date not null,
    end_date date not null,
    duration_days numeric,
    progress numeric not null default 0 check (progress between 0 and 100),
    parent_id uuid references public.tasks(id) on delete set null,
    predecessors jsonb not null default '[]'::jsonb,
    color text,
    sort_order integer not null default 0
);

create index if not exists tasks_schedule_id_idx on public.tasks (schedule_id);
create index if not exists tasks_dates_idx on public.tasks (start_date, end_date);

-- =========================================================================
-- task_elements (N:N task <-> ifc element by GlobalId)
-- =========================================================================
create table if not exists public.task_elements (
    task_id uuid not null references public.tasks(id) on delete cascade,
    ifc_global_id text not null,
    primary key (task_id, ifc_global_id)
);

create index if not exists task_elements_global_id_idx on public.task_elements (ifc_global_id);

-- =========================================================================
-- updated_at trigger
-- =========================================================================
create or replace function public.touch_updated_at()
returns trigger as $$
begin
    new.updated_at := now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at
    before update on public.projects
    for each row execute function public.touch_updated_at();

-- =========================================================================
-- Row Level Security
-- =========================================================================
alter table public.projects       enable row level security;
alter table public.schedules      enable row level security;
alter table public.tasks          enable row level security;
alter table public.task_elements  enable row level security;

-- ---- projects ----
drop policy if exists "projects: owner full access" on public.projects;
create policy "projects: owner full access"
on public.projects
for all
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

-- ---- schedules: only when parent project is owned by auth.uid() ----
drop policy if exists "schedules: via project owner" on public.schedules;
create policy "schedules: via project owner"
on public.schedules
for all
using (
    exists (
        select 1 from public.projects p
        where p.id = schedules.project_id and p.owner_id = auth.uid()
    )
)
with check (
    exists (
        select 1 from public.projects p
        where p.id = schedules.project_id and p.owner_id = auth.uid()
    )
);

-- ---- tasks: via schedule -> project -> owner ----
drop policy if exists "tasks: via project owner" on public.tasks;
create policy "tasks: via project owner"
on public.tasks
for all
using (
    exists (
        select 1
        from public.schedules s
        join public.projects p on p.id = s.project_id
        where s.id = tasks.schedule_id and p.owner_id = auth.uid()
    )
)
with check (
    exists (
        select 1
        from public.schedules s
        join public.projects p on p.id = s.project_id
        where s.id = tasks.schedule_id and p.owner_id = auth.uid()
    )
);

-- ---- task_elements: via task -> schedule -> project -> owner ----
drop policy if exists "task_elements: via project owner" on public.task_elements;
create policy "task_elements: via project owner"
on public.task_elements
for all
using (
    exists (
        select 1
        from public.tasks t
        join public.schedules s on s.id = t.schedule_id
        join public.projects p on p.id = s.project_id
        where t.id = task_elements.task_id and p.owner_id = auth.uid()
    )
)
with check (
    exists (
        select 1
        from public.tasks t
        join public.schedules s on s.id = t.schedule_id
        join public.projects p on p.id = s.project_id
        where t.id = task_elements.task_id and p.owner_id = auth.uid()
    )
);

-- =========================================================================
-- Storage bucket and policies for IFC files
-- Path convention: {owner_id}/{project_id}/model.ifc
-- =========================================================================
insert into storage.buckets (id, name, public)
values ('ifc-files', 'ifc-files', false)
on conflict (id) do nothing;

drop policy if exists "ifc-files: owner read" on storage.objects;
create policy "ifc-files: owner read"
on storage.objects for select
using (
    bucket_id = 'ifc-files'
    and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "ifc-files: owner insert" on storage.objects;
create policy "ifc-files: owner insert"
on storage.objects for insert
with check (
    bucket_id = 'ifc-files'
    and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "ifc-files: owner update" on storage.objects;
create policy "ifc-files: owner update"
on storage.objects for update
using (
    bucket_id = 'ifc-files'
    and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "ifc-files: owner delete" on storage.objects;
create policy "ifc-files: owner delete"
on storage.objects for delete
using (
    bucket_id = 'ifc-files'
    and auth.uid()::text = (storage.foldername(name))[1]
);
