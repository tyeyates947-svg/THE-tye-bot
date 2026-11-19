create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  pin_hash text not null,
  avatar_url text not null default 'pulse:lime',
  balance_gbp numeric(14,2) not null default 10000 check (balance_gbp >= 0),
  total_profit_gbp numeric(14,2) not null default 0,
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.auth_sessions (
  token_hash text primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pin_login_attempts (
  id bigint generated always as identity primary key,
  username text not null,
  ip_hash text not null,
  attempted_at timestamptz not null default now()
);

create table if not exists public.paper_trades (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  symbol text not null,
  asset_type text not null check (asset_type in ('stock', 'crypto')),
  direction text not null check (direction in ('LONG', 'SHORT')),
  timeframe text not null check (timeframe in ('5m', '1d')),
  currency text not null,
  fx_to_gbp numeric(12,6) not null check (fx_to_gbp > 0),
  entry_price numeric(24,8) not null check (entry_price > 0),
  exit_price numeric(24,8),
  units numeric(24,10) not null check (units > 0),
  amount_gbp numeric(14,2) not null check (amount_gbp > 0),
  take_profit numeric(24,8) not null check (take_profit > 0),
  stop_loss numeric(24,8) not null check (stop_loss > 0),
  status text not null default 'open' check (status in ('open', 'closed')),
  pnl_gbp numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists auth_sessions_profile_expiry_idx on public.auth_sessions(profile_id, expires_at);
create index if not exists paper_trades_profile_status_idx on public.paper_trades(profile_id, status, created_at desc);
create index if not exists paper_trades_open_idx on public.paper_trades(status) where status = 'open';
create index if not exists pin_login_attempts_username_time_idx on public.pin_login_attempts(username, attempted_at desc);
create index if not exists pin_login_attempts_ip_time_idx on public.pin_login_attempts(ip_hash, attempted_at desc);

alter table public.profiles enable row level security;
alter table public.auth_sessions enable row level security;
alter table public.pin_login_attempts enable row level security;
alter table public.paper_trades enable row level security;

revoke all on public.profiles, public.auth_sessions, public.pin_login_attempts, public.paper_trades from anon, authenticated;
grant all on public.profiles, public.auth_sessions, public.pin_login_attempts, public.paper_trades to service_role;
grant usage, select on sequence public.pin_login_attempts_id_seq to service_role;

create or replace function public.qp_record_pin_attempt(p_username text, p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_attempts integer;
begin
  perform pg_advisory_xact_lock(hashtext('username:' || lower(p_username)));
  perform pg_advisory_xact_lock(hashtext('ip:' || p_ip_hash));
  delete from public.pin_login_attempts where attempted_at < now() - interval '24 hours';
  insert into public.pin_login_attempts(username, ip_hash) values (lower(p_username), p_ip_hash);
  select count(*) into recent_attempts
  from public.pin_login_attempts
  where attempted_at > now() - interval '15 minutes'
    and (username = lower(p_username) or ip_hash = p_ip_hash);
  return recent_attempts <= 5;
end;
$$;

create or replace function public.qp_open_paper_trade(
  p_profile_id uuid,
  p_symbol text,
  p_asset_type text,
  p_direction text,
  p_timeframe text,
  p_currency text,
  p_fx_to_gbp numeric,
  p_entry_price numeric,
  p_units numeric,
  p_amount_gbp numeric,
  p_take_profit numeric,
  p_stop_loss numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(14,2);
  trade_id uuid;
begin
  select balance_gbp into current_balance
  from public.profiles where id = p_profile_id for update;
  if current_balance is null then raise exception 'Profile not found'; end if;
  if p_amount_gbp <= 0 or p_amount_gbp > current_balance then raise exception 'Insufficient paper balance'; end if;
  if (select count(*) from public.paper_trades where profile_id = p_profile_id and status = 'open') >= 10 then
    raise exception 'Maximum of 10 open paper trades reached';
  end if;
  insert into public.paper_trades(
    profile_id, symbol, asset_type, direction, timeframe, currency, fx_to_gbp,
    entry_price, units, amount_gbp, take_profit, stop_loss
  ) values (
    p_profile_id, upper(p_symbol), p_asset_type, p_direction, p_timeframe, p_currency, p_fx_to_gbp,
    p_entry_price, p_units, p_amount_gbp, p_take_profit, p_stop_loss
  ) returning id into trade_id;
  update public.profiles
  set balance_gbp = balance_gbp - p_amount_gbp, updated_at = now()
  where id = p_profile_id
  returning balance_gbp into current_balance;
  return jsonb_build_object('trade_id', trade_id, 'balance_gbp', current_balance);
end;
$$;

create or replace function public.qp_close_paper_trade(
  p_profile_id uuid,
  p_trade_id uuid,
  p_exit_price numeric,
  p_pnl_gbp numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  position public.paper_trades%rowtype;
  new_balance numeric(14,2);
begin
  select * into position from public.paper_trades
  where id = p_trade_id and profile_id = p_profile_id and status = 'open'
  for update;
  if not found then raise exception 'Open trade not found'; end if;
  update public.paper_trades
  set status = 'closed', exit_price = p_exit_price, pnl_gbp = p_pnl_gbp, closed_at = now()
  where id = p_trade_id;
  update public.profiles
  set balance_gbp = balance_gbp + position.amount_gbp + p_pnl_gbp,
      total_profit_gbp = total_profit_gbp + p_pnl_gbp,
      wins = wins + case when p_pnl_gbp > 0 then 1 else 0 end,
      losses = losses + case when p_pnl_gbp <= 0 then 1 else 0 end,
      updated_at = now()
  where id = p_profile_id
  returning balance_gbp into new_balance;
  return jsonb_build_object('balance_gbp', new_balance, 'pnl_gbp', p_pnl_gbp);
end;
$$;

revoke all on function public.qp_record_pin_attempt(text, text) from public, anon, authenticated;
revoke all on function public.qp_open_paper_trade(uuid, text, text, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.qp_close_paper_trade(uuid, uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function public.qp_record_pin_attempt(text, text) to service_role;
grant execute on function public.qp_open_paper_trade(uuid, text, text, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric) to service_role;
grant execute on function public.qp_close_paper_trade(uuid, uuid, numeric, numeric) to service_role;
