-- Após INSERT em auth.users, preenche email_confirmed_at / confirmed_at para que
-- signUp com a chave anon libere login na hora, sem link de e-mail nem service_role no app.

create or replace function public.confirm_email_on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = auth
as $$
begin
  update auth.users
  set
    email_confirmed_at = coalesce(email_confirmed_at, now()),
    confirmed_at = coalesce(confirmed_at, now())
  where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_auto_confirm on auth.users;

create trigger on_auth_user_created_auto_confirm
  after insert on auth.users
  for each row
  execute function public.confirm_email_on_auth_user_created();
