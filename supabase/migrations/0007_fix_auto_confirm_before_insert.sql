-- O trigger AFTER INSERT + UPDATE em auth.users quebrava o signup no Supabase Auth
-- ("Database error saving new user"). BEFORE INSERT só preenche NEW, sem UPDATE na mesma linha.

create or replace function public.confirm_email_on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = auth
as $$
begin
  new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  new.confirmed_at := coalesce(new.confirmed_at, now());
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_auto_confirm on auth.users;

create trigger on_auth_user_created_auto_confirm
  before insert on auth.users
  for each row
  execute function public.confirm_email_on_auth_user_created();
