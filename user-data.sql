-- Ringside Timer — EACH USER'S SAVED SHOWS AND RIDERS
-- Paste into Supabase → SQL Editor → New query → Run. Safe to run more than once.
--
-- Every user's processed shows and starred riders/horses are kept in their account
-- until THEY delete them (in the app: Load screen → My saved shows → Delete, or
-- Settings → Delete all my data). Nobody else can see or change them.
-- If an account is deleted (Authentication → Users), its saved data is deleted with it.

create table if not exists public.user_shows (
  id          text primary key check (char_length(id) between 4 and 40),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null default 'Show' check (char_length(name) <= 160),
  show_date   date,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint user_show_size check (pg_column_size(data) < 2000000)
);
create index if not exists user_shows_user_idx on public.user_shows (user_id, updated_at desc);

create table if not exists public.user_stars (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  stars      jsonb not null default '{"riders":[],"horses":[]}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint user_stars_size check (pg_column_size(stars) < 200000)
);

alter table public.user_shows enable row level security;
alter table public.user_stars enable row level security;
revoke all on public.user_shows, public.user_stars from anon;
grant select, insert, update, delete on public.user_shows, public.user_stars to authenticated;

drop policy if exists "own shows" on public.user_shows;
create policy "own shows" on public.user_shows for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own stars" on public.user_stars;
create policy "own stars" on public.user_stars for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Keep it reasonable: at most 100 saved shows per account.
create or replace function public.rt_limit_user_shows() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.user_shows where id = new.id) then return new; end if;  -- an update, not a new show
  if (select count(*) from public.user_shows where user_id = new.user_id) >= 100 then
    raise exception 'too_many_saved_shows';
  end if;
  return new;
end $$;
drop trigger if exists rt_limit_user_shows on public.user_shows;
create trigger rt_limit_user_shows before insert on public.user_shows
  for each row execute function public.rt_limit_user_shows();
revoke all on function public.rt_limit_user_shows() from public, anon, authenticated;
