# Personal Investment Operating System

A multi-user investment/deal-tracking app (P2P loans, lending, fixed income, deposits, bonds,
gold schemes, and anything else you add) built against the 55-section spec in
`Investment_Portfolio_Supabase_Skill.docx`. Supabase (Postgres + Auth + Storage + pg_cron) is the
entire backend — there is no Node.js server anywhere in this stack, by design (see Architecture
below). The frontend is a static site: open `web/index.html` directly, or host the `web/` folder
on literally anything that serves static files (Netlify, Vercel static, GitHub Pages, Supabase
Storage, a plain S3 bucket, etc.) — no build step.

## Try it in 10 seconds (no setup)

Open `web/index.html` and click **"Try with Sample Data"** on the sign-in screen. That drops you
straight into every view (Dashboard, Deals, Payments, Analytics, ...) backed by an in-browser
sample portfolio — no Supabase project, no account, nothing saved anywhere. It's real UI wired to
fake data, not screenshots: create a deal, record a payment, run the What-If simulator, all of it
works. A banner stays up the whole time so it's never ambiguous that it's not your real data;
**Exit Demo** returns to the real sign-in screen. This is the fastest way to see the app working —
do this before setting up a real Supabase project.

## Setup

1. **Create a Supabase project** at [supabase.com](https://supabase.com) if you don't have one.
2. **Run the migrations in order.** Open your project's SQL Editor and run each file in
   `supabase/migrations/` in numeric order (`001_extensions.sql` through `013_admin_role.sql`) —
   paste the contents of each file and run it before moving to the next. They're idempotent
   (`create table if not exists`, `drop policy if exists` before `create policy`, etc.), so
   re-running a file if you're unsure whether it applied is safe.
   - `001_extensions.sql` enables `pg_cron`. If that statement errors with a permissions message,
     enable it instead from the dashboard: **Database → Extensions → pg_cron**, then re-run just
     that file (it'll skip the extension line and still be needed for later files to build on).
   - `010_cron.sql` registers the nightly automation job. If the `cron.unschedule('name')` call
     errors because your pg_cron version lacks that overload, see the comment at the bottom of that
     file for the two-line manual alternative.
3. **Create the `documents` storage bucket** — `011_storage.sql` does this via SQL
   (`insert into storage.buckets`), so this normally needs no manual step. If your project's SQL
   Editor role can't insert into `storage.buckets`, create a **private** bucket named `documents`
   from the dashboard instead (**Storage → New bucket**), then re-run `011_storage.sql` for the RLS
   policies.
4. **Open `web/index.html`** (double-click it, or serve the `web/` folder from any static host).
   On first load it asks for your Supabase **Project URL** and **publishable/anon key** — both are
   found in your project's **Settings → API** page, and both are safe to use in client-side code
   (Row Level Security is what actually protects the data, not secrecy of this key).
5. **Create an account** from the sign-up tab. A `profiles` row is created for you automatically
   (via the `handle_new_user` trigger from `003_profiles_platforms_deals.sql`). Anyone else you
   share the app's URL with can create their own account the same way — every new signup gets a
   fully isolated portfolio automatically, no extra setup needed per user.
6. **Make yourself admin (optional).** Run this once in the SQL Editor, after signing up:
   ```sql
   update public.profiles set is_admin = true where email = 'your@email.com';
   ```
   An admin sees an extra **Admin** section in the sidebar listing every registered user, with a
   read-only drill-in into each person's portfolio. This is view-only by design — an admin cannot
   edit another user's deals or payments through the app, only see them (details in
   `013_admin_role.sql`). Everyone else only ever sees their own data, exactly as before.
7. Start adding deals, or use **Import** to upload an Excel/CSV file — `Investment_Import_Template.xlsx`
   (in this same folder) has the exact column headers the import wizard auto-detects, an example
   row, and an Instructions sheet listing the accepted values for Status/Payout Type/Frequency.

## Architecture, in one paragraph

Every piece of backend logic the spec asks for — derived financials, payment-schedule generation,
the payment-confirmation pipeline, nightly reminders, audit logging — lives in Postgres itself
(views, PL/pgSQL functions, triggers, and a `pg_cron` job), because there's no Node/Edge Function
server in this deployment to put it in instead. The frontend (`web/`) is deliberately plain:
`index.html` plus a small set of global-namespace `<script src>` files (no bundler, no ES modules,
no framework) so it keeps working from a double-clicked file or any static host. `web/js/data/api.js`
is the *only* file that talks to Supabase — every view calls through it rather than using
`supabase-js` directly.

## Smoke tests

After running the migrations, these confirm the core engine actually works, from the SQL Editor:

```sql
-- 1. Sign up two test users from the app first, then as each one (or via the SQL editor
--    impersonating each auth.uid()), confirm RLS isolation - each should only ever see their own:
select count(*) from deals;              -- should never show the other user's deals
select count(*) from payments;           -- same

-- 2. Create one ACTIVE deal per user with a maturity_date and Monthly frequency, then:
select public.fn_generate_payment_schedule(<deal_id>);
select scheduled_date, expected_interest, expected_principal, status
from payment_schedule where deal_id = <deal_id> order by scheduled_date;
-- dates should land on sensible monthly boundaries (Postgres clamps month-end automatically,
-- e.g. 31 Jan -> 28/29 Feb), and expected_total = expected_interest + expected_principal always.

-- 3. Record a payment against the first scheduled row and confirm the pipeline ran:
select public.fn_record_payment(<deal_id>, '<scheduled_date>'::date, <expected_total>,
  p_interest_amount := <expected_interest>, p_principal_amount := <expected_principal>);
select status, actual_payment_id from payment_schedule where id = <that_row_id>;  -- now RECEIVED_*
select current_principal, last_payment_date, next_payment_date from deals where id = <deal_id>;
select * from audit_logs where table_name = 'payments' order by changed_at desc limit 5;  -- populated

-- 4. Re-run the exact same fn_record_payment call again - it should fail with a unique_violation
--    on payments (dedupe_key), not create a second row. That's the idempotency guarantee.

-- 5. Manually run the nightly job once instead of waiting for 2am:
select public.fn_refresh_schedule_statuses();
select public.fn_generate_reminders();
select public.fn_generate_ai_insights();
select * from notifications order by scheduled_at desc limit 10;
select * from ai_insights order by generated_at desc limit 10;
```

## Verification performed on this build

The frontend was exercised view-by-view in a browser against an in-memory mock standing in for
Supabase (no live project was available while building this) — every one of the 16 views, the
4-step deal wizard, payment recording, the full Excel import pipeline (upload → auto-map → validate
→ preview → import → schedule generation), the reconciliation flow, voiding a payment, resolving a
reinvestment, and the notification center were driven end-to-end, not just read. That process
caught and fixed three real bugs before they'd have reached a live database:

- A race in `supabaseClient.js`'s session check that could clobber a just-completed sign-in with a
  slightly slower, now-stale "no session" answer.
- `<select>` fields bound to numeric ids (deal/platform pickers) were sending the id as a string
  (`"2"` instead of `2`) — harmless against a loose backend, but a real risk against a `bigint`-typed
  RPC parameter.
- Forms were sending explicit `null` for fields the user left blank, which defeats a Postgres
  column's `DEFAULT` (a default only applies when the column is omitted from the insert, not when
  it's explicitly `NULL`) — `deals.status` would have failed its `NOT NULL` constraint on a real
  database the first time someone created a deal without touching the Status dropdown.

What this testing could *not* cover: the actual SQL running against real Postgres features (RLS
policies, generated columns, triggers, `pg_cron`) — the mock doesn't simulate any of that, so the
smoke tests above are how to close that gap once you have a live project.

## Known limitations / deliberate scope cuts

These are called out here rather than left for you to discover — each is a considered choice, not
an oversight:

- **AI Insights (Section 37) are rule-based, not an LLM call.** `fn_generate_ai_insights()` fills
  templates from real aggregate queries (income trend, maturity concentration, platform
  concentration, overdue count) with the record ids behind each number saved alongside it. There's
  no server here to hold a model API key, and the spec's own requirement — "AI must not invent
  financial figures; every insight should be traceable to underlying records" — is satisfied more
  directly this way than an actual LLM call would.
- **Only the in-app notification channel actually delivers.** Email/Push/WhatsApp/Telegram are real
  columns and a real preference toggle, but sending them needs a secret-holding server (an Edge
  Function plus a provider like Resend/Twilio) this build doesn't include.
- **Future integrations (Section 50)** — lender/platform APIs, open banking, SMS/email parsing,
  Google Calendar, accounting software — are `integration_configs` rows and a Settings screen, all
  starting "Not Connected." The spec asks to "design interfaces for" these, not to build working
  integrations against external providers with no credentials available.
- **Peer-to-peer shared/family portfolios (Section 3's own "may be added later")** still aren't
  wired up: `shared_portfolios` and `portfolio_members` exist as tables with their own RLS, but no
  *other* table's policy has a membership check, so a `portfolio_members` invitation by itself
  doesn't let one regular user see another's deals/payments. What *is* now wired up (`013_admin_role.sql`)
  is a separate, simpler mechanism: one designated **admin** account (`profiles.is_admin`) can
  read every table read-only across every user, via a `private.is_admin()` check added to each
  table's SELECT policy. If true peer-to-peer sharing (not just admin oversight) is wanted later,
  that's the still-open, larger change described above.
- **The Maturity Planner's reinvestment "decision"** (Reinvest/Withdraw/Partially reinvest/Keep as
  cash/Decide later) is stored in the browser's `localStorage`, not the database — it's provisional
  planning state about a deal that hasn't matured yet, not a financial record. Once principal is
  actually returned, the real `reinvestments` table (Section 16) takes over.
- **The nightly cron job runs on the database server's clock (UTC on Supabase)**, not per-user local
  time. For a personal/family-scale app this means a reminder can land a few hours off local
  midnight, never that it's silently skipped.
- **Deleting a deal that has documents but no payments** removes the `documents` metadata rows
  (cascade) but not the underlying files in Storage — a narrow edge case (deals with real payment
  history can't be deleted at all, per the non-negotiable "never delete financial history" rule) not
  worth a Storage-API-calling trigger for.
- **Bank reconciliation matching (Section 23)** uses a simple heuristic (amount within 2%, closest
  date, among still-unresolved schedule rows) — good enough to suggest matches, not a claim of
  certainty; every suggestion still requires an explicit Confirm.

## Project structure

```
supabase/migrations/    13 SQL files, run once in order (see Setup)
web/
  index.html             shell: nav, auth screen, shared modals
  css/app.css
  js/lib/                supabaseClient.js (connection + auth), ui.js (modal + form helpers), utils.js
  js/data/api.js          the only file that calls supabase-js
  js/state.js             global filters (Section 38) + cached lookups
  js/calculations.js      client-side previews (what-if simulator, deal-form estimates)
  js/charts/              Chart.js wrappers
  js/router.js            hash-based view switching, no framework
  js/views/*.js           one module per nav section
  js/app.js               bootstraps auth + sidebar + router
```
