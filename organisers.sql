-- Ringside Timer — APPROVED ORGANISERS ONLY
-- Run this after live-shows.sql (Supabase → SQL Editor → New query → paste → Run). Safe to run more than once.
--
-- Only approved organisers can publish live shows. Anyone signed in can ASK to become one from the
-- Live tab; you approve them here:
--     select public.rt_approve_organiser('person@example.com');
-- See who's waiting:
--     select email, organisation, created_at from public.organiser_requests order by created_at;
-- Remove an organiser (their already-published shows stay until deleted or expired):
--     select public.rt_remove_organiser('person@example.com');

create table if not exists public.organisers (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  approved_at timestamptz not null default now()
);

create table if not exists public.organiser_requests (
  user_id      uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  email        text,
  organisation text not null check (char_length(organisation) between 2 and 120),
  created_at   timestamptz not null default now()
);

alter table public.organisers         enable row level security;
alter table public.organiser_requests enable row level security;
revoke all on public.organisers, public.organiser_requests from anon, authenticated;
grant select on public.organisers to authenticated;                 -- only their own row (policy below)
grant select, insert, delete on public.organiser_requests to authenticated;

drop policy if exists "see own organiser row" on public.organisers;
create policy "see own organiser row" on public.organisers
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "see own request" on public.organiser_requests;
create policy "see own request" on public.organiser_requests
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "make own request" on public.organiser_requests;
create policy "make own request" on public.organiser_requests
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "withdraw own request" on public.organiser_requests;
create policy "withdraw own request" on public.organiser_requests
  for delete to authenticated using (user_id = (select auth.uid()));

-- The email on a request always comes from the person's account (it can't be typed in).
create or replace function public.rt_request_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.user_id := auth.uid();
  new.email := (select email from auth.users where id = auth.uid());
  new.created_at := now();
  return new;
end $$;
drop trigger if exists rt_request_email on public.organiser_requests;
create trigger rt_request_email before insert on public.organiser_requests
  for each row execute function public.rt_request_email();
revoke all on function public.rt_request_email() from public, anon, authenticated;

-- Shows can now only be created through rt_publish_show (which checks for organisers).
revoke insert on public.shows from authenticated;
drop policy if exists "users publish their own shows" on public.shows;

create or replace function public.rt_publish_show(p_name text, p_date date, p_schedule jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_code text;
begin
  if auth.uid() is null then raise exception 'login_required'; end if;
  if not exists (select 1 from public.organisers where user_id = auth.uid()) then
    raise exception 'not_organiser';
  end if;
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

-- For you (run in the SQL Editor). Not callable from the website.
create or replace function public.rt_approve_organiser(p_email text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then return 'No account with that email. Ask them to create an account first.'; end if;
  insert into public.organisers (user_id) values (v_user) on conflict do nothing;
  delete from public.organiser_requests where user_id = v_user;
  return 'Approved: ' || p_email;
end $$;

create or replace function public.rt_remove_organiser(p_email text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then return 'No account with that email.'; end if;
  delete from public.organisers where user_id = v_user;
  return 'Removed organiser: ' || p_email;
end $$;

revoke all on function public.rt_approve_organiser(text), public.rt_remove_organiser(text) from public, anon, authenticated;
revoke all on function public.rt_publish_show(text, date, jsonb) from public, anon;
grant execute on function public.rt_publish_show(text, date, jsonb) to authenticated;
