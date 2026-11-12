-- Ringside Timer — database setup
-- Paste this whole file into Supabase → SQL Editor → New query, then click "Run".
-- It is safe to run more than once.

-- 1) The rate-limit table. It holds ONLY a hashed IP, a timestamp and a success flag.
--    No schedule contents, names or results are ever stored.
create table if not exists public.parse_requests (
  id          bigint generated always as identity primary key,
  ip_hash     text        not null,
  created_at  timestamptz not null default now(),
  success     boolean     not null default false
);

create index if not exists parse_requests_created_at_idx on public.parse_requests (created_at);
create index if not exists parse_requests_ip_day_idx     on public.parse_requests (ip_hash, created_at);

-- 2) Lock the table. Row Level Security is ON and there are NO policies, so the
--    public (anon) and logged-in users can't read, add, change or delete rows.
--    Only the Edge Function (which uses the private service role) can use it.
alter table public.parse_requests enable row level security;
revoke all on table public.parse_requests from anon, authenticated;

-- 3) Automatic clean-up: delete rows older than 30 days, every night at 02:15 (UTC).
--    Uses the pg_cron extension that comes with Supabase.
create extension if not exists pg_cron;

select cron.schedule(
  'ringside-delete-old-parse-requests',
  '15 2 * * *',
  $$ delete from public.parse_requests where created_at < now() - interval '30 days' $$
);

-- Handy checks you can run later (select one line and click Run):
--   select count(*) filter (where success) as ok, count(*) filter (where not success) as failed
--     from public.parse_requests where created_at > now() - interval '1 day';
--   select * from cron.job;                                  -- see the clean-up job
--   select * from cron.job_run_details order by start_time desc limit 5;  -- did it run?
