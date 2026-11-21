alter table public.paper_trades
  drop constraint if exists paper_trades_status_check;

alter table public.paper_trades
  add constraint paper_trades_status_check check (status in ('scheduled', 'open', 'closed', 'cancelled')),
  add column if not exists entry_at timestamptz,
  add column if not exists duration_minutes integer,
  add column if not exists expires_at timestamptz,
  add column if not exists mode text not null default 'hunter' check (mode in ('hunter', 'sniper'));

update public.paper_trades
set entry_at = coalesce(entry_at, created_at),
    duration_minutes = coalesce(duration_minutes, 1440),
    expires_at = coalesce(expires_at, now() + interval '100 years');

alter table public.paper_trades
  alter column entry_at set default now(),
  alter column entry_at set not null,
  alter column duration_minutes set default 1440,
  alter column duration_minutes set not null,
  alter column expires_at set default (now() + interval '1 day'),
  alter column expires_at set not null;

alter table public.paper_trades
  add constraint paper_trades_duration_minutes_check check (duration_minutes between 5 and 10080);

alter table public.profiles
  add column if not exists paper_account_provider text check (paper_account_provider in ('trading212', 'alpaca')),
  add column if not exists paper_account_verified boolean not null default false,
  add column if not exists paper_account_balance_gbp numeric(14,2),
  add column if not exists paper_account_equity_gbp numeric(14,2),
  add column if not exists paper_account_profit_gbp numeric(14,2),
  add column if not exists paper_account_win_rate numeric(5,2),
  add column if not exists paper_account_open_profit_gbp numeric(14,2),
  add column if not exists paper_account_closed_profit_gbp numeric(14,2),
  add column if not exists paper_account_open_positions integer;

create table if not exists public.connected_paper_accounts (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('trading212', 'alpaca')),
  credentials_ciphertext text not null,
  updated_at timestamptz not null default now()
);

create index if not exists paper_trades_scheduled_idx on public.paper_trades(profile_id, entry_at) where status = 'scheduled';
create index if not exists paper_trades_expiration_idx on public.paper_trades(profile_id, expires_at) where status = 'open';

alter table public.connected_paper_accounts enable row level security;
revoke all on public.connected_paper_accounts from anon, authenticated;
grant all on public.connected_paper_accounts to service_role;

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
  p_stop_loss numeric,
  p_entry_at timestamptz,
  p_duration_minutes integer,
  p_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(14,2);
  trade_id uuid;
  start_at timestamptz;
begin
  start_at := greatest(p_entry_at, now());
  if p_duration_minutes < 5 or p_duration_minutes > 10080 or p_mode not in ('hunter', 'sniper') then
    raise exception 'Invalid trade duration or analysis mode';
  end if;
  select balance_gbp into current_balance
  from public.profiles where id = p_profile_id for update;
  if current_balance is null then raise exception 'Profile not found'; end if;
  if p_amount_gbp <= 0 or p_amount_gbp > current_balance then raise exception 'Insufficient paper balance'; end if;
  if (select count(*) from public.paper_trades where profile_id = p_profile_id and status in ('scheduled', 'open')) >= 10 then
    raise exception 'Maximum of 10 open paper trades reached';
  end if;
  insert into public.paper_trades(
    profile_id, symbol, asset_type, direction, timeframe, currency, fx_to_gbp,
    entry_price, units, amount_gbp, take_profit, stop_loss, status, entry_at,
    duration_minutes, expires_at, mode
  ) values (
    p_profile_id, upper(p_symbol), p_asset_type, p_direction, p_timeframe, p_currency, p_fx_to_gbp,
    p_entry_price, p_units, p_amount_gbp, p_take_profit, p_stop_loss,
    case when start_at > now() then 'scheduled' else 'open' end,
    start_at, p_duration_minutes, start_at + make_interval(mins => p_duration_minutes), p_mode
  ) returning id into trade_id;
  update public.profiles
  set balance_gbp = balance_gbp - p_amount_gbp, updated_at = now()
  where id = p_profile_id
  returning balance_gbp into current_balance;
  return jsonb_build_object('trade_id', trade_id, 'balance_gbp', current_balance);
end;
$$;

create or replace function public.qp_activate_scheduled_paper_trade(
  p_profile_id uuid,
  p_trade_id uuid,
  p_entry_price numeric,
  p_units numeric
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.paper_trades
  set status = 'open', entry_price = p_entry_price, units = p_units
  where id = p_trade_id and profile_id = p_profile_id and status = 'scheduled' and entry_at <= now();
  return found;
end;
$$;

create or replace function public.qp_cancel_scheduled_paper_trade(
  p_profile_id uuid,
  p_trade_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  reserved_amount numeric(14,2);
begin
  select amount_gbp into reserved_amount
  from public.paper_trades
  where id = p_trade_id and profile_id = p_profile_id and status = 'scheduled'
  for update;
  if not found then return false; end if;
  update public.paper_trades
  set status = 'cancelled', pnl_gbp = 0, closed_at = now()
  where id = p_trade_id;
  update public.profiles
  set balance_gbp = balance_gbp + reserved_amount, updated_at = now()
  where id = p_profile_id;
  return true;
end;
$$;

revoke all on function public.qp_open_paper_trade(uuid, text, text, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.qp_open_paper_trade(uuid, text, text, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, timestamptz, integer, text) from public, anon, authenticated;
revoke all on function public.qp_activate_scheduled_paper_trade(uuid, uuid, numeric, numeric) from public, anon, authenticated;
revoke all on function public.qp_cancel_scheduled_paper_trade(uuid, uuid) from public, anon, authenticated;
grant execute on function public.qp_open_paper_trade(uuid, text, text, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, timestamptz, integer, text) to service_role;
grant execute on function public.qp_activate_scheduled_paper_trade(uuid, uuid, numeric, numeric) to service_role;
grant execute on function public.qp_cancel_scheduled_paper_trade(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
