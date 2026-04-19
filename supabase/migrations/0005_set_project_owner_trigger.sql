-- Ensure new projects get owner_id = auth.uid() when inserted via the app
-- (inserts omit owner_id on purpose — RLS requires the row to belong to the caller).

create or replace function public.set_project_owner_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.owner_id is null then
    new.owner_id := auth.uid();
  end if;
  if new.owner_id is null then
    raise exception 'owner_id is required (not authenticated)';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_set_owner_id on public.projects;
create trigger projects_set_owner_id
  before insert on public.projects
  for each row
  execute function public.set_project_owner_id();
