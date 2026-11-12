-- Ringside Timer — LIVE SHOWS (shared shows, marshals, live timing)
-- Paste this whole file into Supabase → SQL Editor → New query, then click "Run".
-- It is safe to run more than once.
--
-- What it creates
--   shows             one row per published show: the schedule + the live state from marshals
--   show_codes        the private marshal code for each show (only the publisher can see it)
--   show_marshals     which accounts have entered the code (and may update the show)
--   marshal_attempts  wrong-code attempts, to stop people guessing codes
-- Who can do what (enforced by the database, not just the website)
--   any signed-in user  can see published shows, and can publish their own
--   the publisher       can edit/unpublish/delete their show and see/change its marshal code
--   marshals            can only update the live timing (via rt_live_update)
-- Privacy (POPIA): shows (with riders' and horses' names) are deleted automatically
-- 7 days after the show date.

create table if not exists public.shows (
  id               uuid primary key default gen_random_uuid(),
  owner            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 160),
  show_date        date,
  schedule         jsonb not null,
  schedule_version integer not null default 1,
  live             jsonb not null default '{}'::jsonb,
  live_version     integer not null default 0,
  live_updated_at  timestamptz,
  published        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint schedule_size check (pg_column_size(schedule) < 1000000),
  constraint live_size     check (pg_column_size(live) < 1000000)
);
create index if not exists shows_date_idx on public.shows (show_date);

create table if not exists public.show_codes (
  show_id uuid primary key references public.shows (id) on delete cascade,
  code    text not null
);

create table if not exists public.show_marshals (
  show_id    uuid not null references public.shows (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (show_id, user_id)
);

create table if not exists public.marshal_attempts (
  id      bigint generated always as identity primary key,
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index if not exists marshal_attempts_user_idx on public.marshal_attempts (user_id, at);

-- ---------------------------------------------------------------- security
alter table public.shows            enable row level security;
alter table public.show_codes       enable row level security;
alter table public.show_marshals    enable row level security;
alter table public.marshal_attempts enable row level security;

revoke all on public.shows, public.show_codes, public.show_marshals, public.marshal_attempts from anon;
revoke all on public.show_codes, public.marshal_attempts from authenticated;
grant select, insert, update, delete on public.shows to authenticated;
grant select on public.show_marshals to authenticated;

drop policy if exists "signed-in users see published shows" on public.shows;
create policy "signed-in users see published shows" on public.shows
  for select to authenticated using (published or owner = (select auth.uid()));

drop policy if exists "users publish their own shows" on public.shows;
create policy "users publish their own shows" on public.shows
  for insert to authenticated with check (owner = (select auth.uid()));

drop policy if exists "owners edit their shows" on public.shows;
create policy "owners edit their shows" on public.shows
  for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

drop policy if exists "owners delete their shows" on public.shows;
create policy "owners delete their shows" on public.shows
  for delete to authenticated using (owner = (select auth.uid()));

drop policy if exists "see own marshal rows" on public.show_marshals;
create policy "see own marshal rows" on public.show_marshals
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- helpers
create or replace function public.rt_make_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- no 0/O, 1/I lookalikes
  b bytea := uuid_send(gen_random_uuid());
  v_out text := '';
begin
  for i in 0..5 loop
    v_out := v_out || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
  end loop;
  return v_out;
end $$;

-- Publish a show: creates the show and its marshal code, returns both.
create or replace function public.rt_publish_show(p_name text, p_date date, p_schedule jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_code text;
begin
  if auth.uid() is null then raise exception 'login_required'; end if;
  if (select count(*) from public.shows where owner = auth.uid() and created_at > now() - interval '1 day') >= 20 then
    raise exception 'too_many_shows';
  end if;
  insert into public.shows (owner, name, show_date, schedule)
    values (auth.uid(), left(coalesce(nullif(trim(p_name), ''), 'Show'), 160), p_date, p_schedule)
    returning id into v_id;
  v_code := public.rt_make_code();
  insert into public.show_codes (show_id, code) values (v_id, v_code);
  return json_build_object('id', v_id, 'code', v_code);
end $$;

-- Publisher only: see or replace the marshal code (replacing it removes existing marshals).
create or replace function public.rt_get_code(p_show uuid, p_new boolean default false)
returns text language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  if not exists (select 1 from public.shows where id = p_show and owner = auth.uid()) then
    raise exception 'not_owner';
  end if;
  if p_new then
    v_code := public.rt_make_code();
    update public.show_codes set code = v_code where show_id = p_show;
    delete from public.show_marshals where show_id = p_show;
  else
    select code into v_code from public.show_codes where show_id = p_show;
  end if;
  return v_code;
end $$;

-- Become a marshal by entering the code. Max 10 wrong codes per hour per account.
create or replace function public.rt_join_marshal(p_show uuid, p_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'login_required'; end if;
  if (select count(*) from public.marshal_attempts where user_id = auth.uid() and at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_attempts';
  end if;
  if exists (select 1 from public.show_codes where show_id = p_show and code = upper(trim(p_code))) then
    insert into public.show_marshals (show_id, user_id) values (p_show, auth.uid()) on conflict do nothing;
    return true;
  end if;
  insert into public.marshal_attempts (user_id) values (auth.uid());
  return false;
end $$;

-- Marshals and the publisher: merge live timing changes.
-- p_patch = {"classes": {"<classId>": {...live state...}}, "status": {"<entryId>": "scratched"|"starting"|"done"}}
create or replace function public.rt_live_update(p_show uuid, p_patch jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_ver integer;
begin
  if auth.uid() is null then raise exception 'login_required'; end if;
  if not exists (select 1 from public.shows s where s.id = p_show and s.owner = auth.uid())
     and not exists (select 1 from public.show_marshals m where m.show_id = p_show and m.user_id = auth.uid()) then
    raise exception 'not_marshal';
  end if;
  update public.shows set
    live = jsonb_build_object(
      'classes', coalesce(live->'classes', '{}'::jsonb) || coalesce(p_patch->'classes', '{}'::jsonb),
      'status',  coalesce(live->'status',  '{}'::jsonb) || coalesce(p_patch->'status',  '{}'::jsonb)),
    live_version = live_version + 1,
    live_updated_at = now()
  where id = p_show
  returning live_version into v_ver;
  return v_ver;
end $$;

revoke all on function public.rt_make_code() from public, anon, authenticated;
revoke all on function public.rt_publish_show(text, date, jsonb), public.rt_get_code(uuid, boolean),
  public.rt_join_marshal(uuid, text), public.rt_live_update(uuid, jsonb) from public, anon;
grant execute on function public.rt_publish_show(text, date, jsonb), public.rt_get_code(uuid, boolean),
  public.rt_join_marshal(uuid, text), public.rt_live_update(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- automatic clean-up (POPIA)
-- Every night at 01:30 UTC: delete shows 7 days after their show date
-- (or 7 days after publishing if no date was given), and old wrong-code attempts.
create extension if not exists pg_cron;
select cron.schedule(
  'ringside-delete-old-shows',
  '30 1 * * *',
  $$ delete from public.shows where coalesce(show_date, created_at::date) < current_date - 7;
     delete from public.marshal_attempts where at < now() - interval '1 day'; $$
);
