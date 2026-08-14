-- ============================================================================
-- 010: pg_cron registration (spec Section 42 "Daily Automation")
-- ============================================================================
-- This is the entire "server" for scheduled work in this deployment - there
-- is no Node/Edge Function process running it, Postgres does it itself.
--
-- Runs once daily against the database server's own clock (UTC on
-- Supabase), not per-user local time. For a personal/family-scale app this
-- is a reasonable simplification (flagged in the README); it means a
-- reminder can land up to several hours off a user's local midnight rather
-- than none at all.
-- ============================================================================

do $$
begin
  if exists (select 1 from cron.job where jobname = 'nightly-portfolio-automation') then
    perform cron.unschedule('nightly-portfolio-automation');
  end if;
end $$;

select cron.schedule(
  'nightly-portfolio-automation',
  '0 2 * * *',
  $$
  select public.fn_refresh_schedule_statuses();
  select public.fn_generate_reminders();
  select public.fn_generate_ai_insights();
  $$
);

-- If the DO block above errors because this pg_cron version lacks the
-- unschedule-by-name overload, unschedule manually first:
--   select cron.unschedule(jobid) from cron.job where jobname = 'nightly-portfolio-automation';
-- then re-run just the cron.schedule(...) call above. Or use the Supabase
-- dashboard's Database -> Cron Jobs UI instead of SQL.
