create table if not exists public.auth_sessions (
  token_hash text primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists auth_sessions_profile_expiry_idx
  on public.auth_sessions(profile_id, expires_at);

alter table public.auth_sessions enable row level security;
revoke all on public.auth_sessions from anon, authenticated;
grant all on public.auth_sessions to service_role;

notify pgrst, 'reload schema';
