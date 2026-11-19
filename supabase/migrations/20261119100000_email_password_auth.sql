alter table public.profiles
  add column if not exists email text,
  add column if not exists password_hash text;

alter table public.profiles alter column pin_hash drop not null;

create unique index if not exists profiles_email_unique_idx
  on public.profiles (lower(email))
  where email is not null;

create table if not exists public.auth_login_attempts (
  id bigint generated always as identity primary key,
  email text not null,
  ip_hash text not null,
  attempted_at timestamptz not null default now()
);

create index if not exists auth_login_attempts_email_time_idx
  on public.auth_login_attempts (email, attempted_at desc);
create index if not exists auth_login_attempts_ip_time_idx
  on public.auth_login_attempts (ip_hash, attempted_at desc);

alter table public.auth_login_attempts enable row level security;
revoke all on public.auth_login_attempts from anon, authenticated;
grant all on public.auth_login_attempts to service_role;
grant usage, select on sequence public.auth_login_attempts_id_seq to service_role;

create or replace function public.qp_record_auth_attempt(p_email text, p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_attempts integer;
begin
  perform pg_advisory_xact_lock(hashtext('email:' || lower(p_email)));
  perform pg_advisory_xact_lock(hashtext('ip:' || p_ip_hash));
  delete from public.auth_login_attempts where attempted_at < now() - interval '24 hours';
  insert into public.auth_login_attempts(email, ip_hash)
  values (lower(p_email), p_ip_hash);
  select count(*) into recent_attempts
  from public.auth_login_attempts
  where attempted_at > now() - interval '15 minutes'
    and (email = lower(p_email) or ip_hash = p_ip_hash);
  return recent_attempts <= 5;
end;
$$;

revoke all on function public.qp_record_auth_attempt(text, text) from public, anon, authenticated;
grant execute on function public.qp_record_auth_attempt(text, text) to service_role;

notify pgrst, 'reload schema';
