/* Demo Mode: an in-memory stand-in for Supabase so the whole app can be
   explored with sample data and zero setup - no project, no signup. Entered
   from the auth screen's "Try Demo" link (see app.js); everything here
   resets on reload, and nothing in it is ever real financial data.

   This implements the same subset of the supabase-js surface that
   js/data/api.js calls against (from/select/insert/update/delete/upsert/rpc,
   auth, storage), plus enough Postgres-feature simulation (generated
   columns on reinvestments, the audit trigger) that the views relying on
   them don't look broken in a walkthrough. */
window.App = window.App || {};

App.demo = (function () {
  const DB = {
    profiles: [], platforms: [], deals: [], payment_schedule: [], payments: [], reinvestments: [],
    notifications: [], notification_preferences: [], documents: [], audit_logs: [], imports: [],
    portfolio_goals: [], cash_transactions: [], investment_categories: [], risk_ratings: [],
    bank_transactions: [], payment_matches: [], tax_records: [], ai_insights: [], scenario_simulations: [],
    integration_configs: [],
  };
  const counters = {};
  function genId(table) { counters[table] = (counters[table] || 0) + 1; return counters[table]; }
  const DEMO_USER = { id: 'demo-user', email: 'demo@example.com' };
  const nowIso = () => new Date().toISOString();

  function matchesRow(row, f) {
    for (const [k, v] of Object.entries(f.eq)) if (row[k] !== v) return false;
    for (const [k, v] of Object.entries(f.in)) if (!v.includes(row[k])) return false;
    for (const [k, v] of Object.entries(f.gte)) if (!(row[k] >= v)) return false;
    for (const [k, v] of Object.entries(f.lte)) if (!(row[k] <= v)) return false;
    for (const [k, v] of Object.entries(f.is)) if (!(v === null ? (row[k] === null || row[k] === undefined) : row[k] === v)) return false;
    return true;
  }

  // Mirrors the real reinvestments generated columns (004_payment_engine.sql)
  // - recomputed whenever the underlying columns change, same as Postgres
  // would do automatically.
  function recomputeReinvestmentColumns(row) {
    if (row.reinvestment_date && row.returned_date) {
      row.reinvestment_delay_days = Math.round((new Date(row.reinvestment_date) - new Date(row.returned_date)) / 86400000);
      row.same_day_reinvestment = row.reinvestment_delay_days === 0;
    } else {
      row.reinvestment_delay_days = null;
      row.same_day_reinvestment = false;
    }
    row.reinvestment_ratio = (row.returned_amount && row.reinvested_amount != null)
      ? Math.round((row.reinvested_amount / row.returned_amount) * 10000) / 10000 : null;
  }

  // Mirrors audit_row_change() (006_audit_imports.sql): one row per changed
  // field on UPDATE, one summary row on INSERT.
  const AUDITED_TABLES = new Set(['deals', 'payments', 'payment_schedule', 'reinvestments']);
  function auditInsert(table, row) {
    if (!AUDITED_TABLES.has(table)) return;
    DB.audit_logs.push({ id: genId('audit_logs'), user_id: row.user_id, table_name: table, record_id: row.id, action: 'INSERT', field_name: null, old_value: null, new_value: JSON.stringify(row), source: 'system', changed_at: nowIso() });
  }
  function auditUpdate(table, before, after) {
    if (!AUDITED_TABLES.has(table)) return;
    Object.keys(after).forEach((key) => {
      if (key === 'updated_at' || key === 'created_at') return;
      const oldVal = before[key], newVal = after[key];
      if (oldVal === newVal) return;
      DB.audit_logs.push({ id: genId('audit_logs'), user_id: after.user_id, table_name: table, record_id: after.id, action: 'UPDATE', field_name: key, old_value: oldVal == null ? null : String(oldVal), new_value: newVal == null ? null : String(newVal), source: 'system', changed_at: nowIso() });
    });
  }

  class QB {
    constructor(table) { this.table = table; this.op = 'select'; this.filters = { eq: {}, in: {}, gte: {}, lte: {}, is: {} }; }
    eq(k, v) { this.filters.eq[k] = v; return this; }
    in(k, v) { this.filters.in[k] = v; return this; }
    gte(k, v) { this.filters.gte[k] = v; return this; }
    lte(k, v) { this.filters.lte[k] = v; return this; }
    is(k, v) { this.filters.is[k] = v; return this; }
    order(col, opts) { this._order = { col, asc: !opts || opts.ascending !== false }; return this; }
    limit(n) { this._limit = n; return this; }
    select() { return this; }
    single() { this._single = true; return this._exec(); }
    maybeSingle() { this._maybeSingle = true; return this._exec(); }
    insert(row) { this.op = 'insert'; this._payload = row; return this; }
    update(patch) { this.op = 'update'; this._payload = patch; return this; }
    delete() { this.op = 'delete'; return this; }
    upsert(row, opts) { this.op = 'upsert'; this._payload = row; this._onConflict = opts && opts.onConflict; return this; }
    then(resolve, reject) { return this._exec().then(resolve, reject); }
    async _exec() {
      await new Promise((r) => setTimeout(r, 15));
      if (VIRTUAL_TABLES[this.table] && this.op === 'select') {
        const rows = VIRTUAL_TABLES[this.table]().filter((r) => matchesRow(r, this.filters));
        if (this._single) return rows.length ? { data: rows[0], error: null } : { data: null, error: { message: 'No rows found' } };
        if (this._maybeSingle) return { data: rows[0] || null, error: null };
        return { data: rows, error: null };
      }
      const table = DB[this.table] || (DB[this.table] = []);
      if (this.op === 'select') {
        let rows = table.filter((r) => matchesRow(r, this.filters));
        if (this._order) rows = rows.slice().sort((a, b) => {
          const av = a[this._order.col], bv = b[this._order.col];
          if (av === bv) return 0;
          return (av < bv ? -1 : 1) * (this._order.asc ? 1 : -1);
        });
        if (this._limit) rows = rows.slice(0, this._limit);
        if (this._single) return rows.length ? { data: rows[0], error: null } : { data: null, error: { message: 'No rows found' } };
        if (this._maybeSingle) return { data: rows[0] || null, error: null };
        return { data: rows, error: null };
      }
      if (this.op === 'insert') {
        const rows = Array.isArray(this._payload) ? this._payload : [this._payload];
        const inserted = rows.map((r) => {
          const row = Object.assign({ id: genId(this.table), created_at: nowIso(), updated_at: nowIso() }, r);
          if (this.table === 'reinvestments') recomputeReinvestmentColumns(row);
          table.push(row);
          auditInsert(this.table, row);
          return row;
        });
        return this._single ? { data: inserted[0], error: null } : { data: inserted, error: null };
      }
      if (this.op === 'update') {
        const rows = table.filter((r) => matchesRow(r, this.filters));
        rows.forEach((r) => {
          const before = Object.assign({}, r);
          Object.assign(r, this._payload, { updated_at: nowIso() });
          if (this.table === 'reinvestments') recomputeReinvestmentColumns(r);
          auditUpdate(this.table, before, r);
        });
        return this._single ? { data: rows[0], error: null } : { data: rows, error: null };
      }
      if (this.op === 'delete') {
        const toDelete = new Set(table.filter((r) => matchesRow(r, this.filters)));
        DB[this.table] = table.filter((r) => !toDelete.has(r));
        return { data: null, error: null };
      }
      if (this.op === 'upsert') {
        const keys = this._onConflict ? this._onConflict.split(',') : ['id'];
        let existing = table.find((r) => keys.every((k) => r[k] === this._payload[k]));
        if (existing) Object.assign(existing, this._payload, { updated_at: nowIso() });
        else { existing = Object.assign({ id: genId(this.table), created_at: nowIso(), updated_at: nowIso() }, this._payload); table.push(existing); }
        return { data: existing, error: null };
      }
    }
  }

  // ---- virtual "tables" mirroring the real SQL views (008_views.sql) ----
  const VIRTUAL_TABLES = {
    v_deal_metrics: () => DB.deals.map((d) => {
      const pay = DB.payments.filter((p) => p.deal_id === d.id && !p.is_voided);
      const sched = DB.payment_schedule.filter((s) => s.deal_id === d.id);
      const principal_returned = pay.reduce((a, p) => a + (p.principal_amount || 0), 0);
      const interest_received = pay.reduce((a, p) => a + (p.interest_amount || 0), 0);
      const total_received = pay.reduce((a, p) => a + (p.amount || 0), 0);
      const pending = ['UPCOMING', 'DUE_TODAY', 'OVERDUE'];
      const interest_pending = sched.filter((s) => pending.includes(s.status)).reduce((a, s) => a + (s.expected_interest || 0), 0);
      const completed = sched.filter((s) => ['RECEIVED', 'RECEIVED_EARLY', 'RECEIVED_ON_TIME', 'RECEIVED_LATE', 'PARTIALLY_RECEIVED', 'MISSED'].includes(s.status));
      const goodCount = sched.filter((s) => ['RECEIVED', 'RECEIVED_EARLY', 'RECEIVED_ON_TIME'].includes(s.status)).length;
      const days_active = Math.round((Date.now() - new Date(d.start_date)) / 86400000);
      return {
        deal_id: d.id, user_id: d.user_id, platform_id: d.platform_id, status: d.status,
        invested_amount: d.invested_amount, current_principal: d.current_principal,
        days_active, principal_returned, interest_received, interest_pending, total_received,
        total_outstanding: Math.max(0, d.invested_amount - principal_returned),
        realized_roi: d.invested_amount ? interest_received / d.invested_amount * 100 : null,
        annualized_realized_roi: d.invested_amount && days_active > 0 ? interest_received / d.invested_amount * 100 * (365 / days_active) : null,
        payout_reliability: completed.length ? goodCount / completed.length * 100 : null,
        recovery_percentage: d.invested_amount ? principal_returned / d.invested_amount * 100 : null,
        missed_payment_count: sched.filter((s) => s.status === 'MISSED').length,
      };
    }),
    v_portfolio_summary: () => {
      const metrics = VIRTUAL_TABLES.v_deal_metrics();
      const totalInvested = DB.deals.reduce((a, d) => a + (d.invested_amount || 0), 0);
      const currentOutstanding = DB.deals.reduce((a, d) => a + (d.current_principal || 0), 0);
      const interestEarned = metrics.reduce((a, m) => a + (m.interest_received || 0), 0);
      const interestPending = metrics.reduce((a, m) => a + (m.interest_pending || 0), 0);
      const active = DB.deals.filter((d) => d.status === 'ACTIVE');
      const weightedNum = active.filter((d) => d.annual_roi != null).reduce((a, d) => a + d.annual_roi * d.invested_amount, 0);
      const weightedDen = active.filter((d) => d.annual_roi != null).reduce((a, d) => a + d.invested_amount, 0);
      return [{
        user_id: DEMO_USER.id, total_invested: totalInvested, current_outstanding_principal: currentOutstanding,
        principal_returned: metrics.reduce((a, m) => a + (m.principal_returned || 0), 0),
        interest_earned: interestEarned, interest_pending: interestPending,
        expected_future_interest: active.reduce((a, d) => a + Math.max(0, (d.expected_total_interest || 0) - ((metrics.find((m) => m.deal_id === d.id) || {}).interest_received || 0)), 0),
        total_portfolio_value: currentOutstanding + interestPending,
        net_profit: interestEarned - DB.deals.reduce((a, d) => a + (d.fees || 0) + (d.tax_withheld || 0), 0),
        realized_roi: totalInvested ? interestEarned / totalInvested * 100 : null,
        annualized_roi: totalInvested ? interestEarned / totalInvested * 100 * 4 : null,
        weighted_average_roi: weightedDen ? weightedNum / weightedDen : null,
        active_deals_count: active.length,
        closed_deals_count: DB.deals.filter((d) => ['CLOSED', 'MATURED'].includes(d.status)).length,
        overdue_deals_count: new Set(DB.payment_schedule.filter((s) => s.status === 'OVERDUE').map((s) => s.deal_id)).size,
      }];
    },
  };

  // ---- schedule generation, mirrors fn_generate_payment_schedule (009_functions.sql) ----
  function generateSchedule(dealId) {
    const d = DB.deals.find((x) => x.id === dealId);
    if (!d || !d.maturity_date || ['Irregular', 'Custom'].includes(d.payment_frequency)) return 0;
    DB.payment_schedule = DB.payment_schedule.filter((s) => !(s.deal_id === dealId && ['UPCOMING', 'DUE_TODAY', 'OVERDUE'].includes(s.status)));
    const stepMonths = { Monthly: 1, Quarterly: 3, 'Half-Yearly': 6, Yearly: 12, 'At Maturity': null }[d.payment_frequency];
    const dates = [];
    if (d.payment_frequency === 'At Maturity') dates.push(d.maturity_date);
    else {
      let cur = new Date(d.first_payment_date || d.start_date);
      if (!d.first_payment_date) cur.setMonth(cur.getMonth() + stepMonths);
      const end = new Date(d.maturity_date);
      let guard = 0;
      while (cur <= end && guard < 600) { dates.push(cur.toISOString().slice(0, 10)); cur = new Date(cur); cur.setMonth(cur.getMonth() + stepMonths); guard++; }
      if (!dates.length || dates[dates.length - 1] !== d.maturity_date) dates.push(d.maturity_date);
    }
    const periodsPerYear = { Monthly: 12, Quarterly: 4, 'Half-Yearly': 2, Yearly: 1, 'At Maturity': 1 }[d.payment_frequency];
    const ratePerPeriod = (d.annual_roi || 0) / 100 / periodsPerYear;
    let balance = d.invested_amount;
    dates.forEach((date, i) => {
      const isFinal = i === dates.length - 1;
      let interest = Math.round(balance * ratePerPeriod * 100) / 100;
      let principal = 0;
      if (d.payout_type === 'Interest Only') principal = 0;
      else if (isFinal) principal = balance;
      else if (d.payout_type === 'Interest + Principal' || d.payout_type === 'EMI') principal = Math.round(d.invested_amount / dates.length * 100) / 100;
      const row = {
        id: genId('payment_schedule'), user_id: DEMO_USER.id, deal_id: dealId, scheduled_date: date,
        expected_interest: interest, expected_principal: principal, expected_total: interest + principal,
        payment_type: d.payout_type, status: 'UPCOMING', grace_period_days: 3, actual_payment_id: null,
        created_at: nowIso(), updated_at: nowIso(),
      };
      DB.payment_schedule.push(row);
      auditInsert('payment_schedule', row);
      balance = Math.max(0, balance - principal);
    });
    d.next_payment_date = dates[0];
    return dates.length;
  }

  // ---- payment recording, mirrors fn_record_payment (009_functions.sql) ----
  function recordPayment(p) {
    const deal = DB.deals.find((d) => d.id === p.p_deal_id);
    if (!deal) throw new Error('Deal not found');
    const candidates = DB.payment_schedule.filter((s) => s.deal_id === p.p_deal_id && ['UPCOMING', 'DUE_TODAY', 'OVERDUE', 'PARTIALLY_RECEIVED'].includes(s.status));
    candidates.sort((a, b) => Math.abs(new Date(a.scheduled_date) - new Date(p.p_transaction_date)) - Math.abs(new Date(b.scheduled_date) - new Date(p.p_transaction_date)));
    const sched = p.p_scheduled_payment_id ? DB.payment_schedule.find((s) => s.id === p.p_scheduled_payment_id) : candidates[0];
    const payment = {
      id: genId('payments'), user_id: DEMO_USER.id, deal_id: p.p_deal_id, scheduled_payment_id: sched ? sched.id : null,
      transaction_date: p.p_transaction_date, amount: p.p_amount, interest_amount: p.p_interest_amount,
      principal_amount: p.p_principal_amount, fee_amount: p.p_fee_amount || 0, tax_amount: p.p_tax_amount || 0,
      payment_reference: p.p_payment_reference, payment_mode: p.p_payment_mode, confirmation_method: p.p_confirmation_method || 'Manual',
      notes: p.p_notes, is_voided: false, created_at: nowIso(), updated_at: nowIso(),
    };
    const dupe = DB.payments.find((x) => x.deal_id === payment.deal_id && x.transaction_date === payment.transaction_date && x.amount === payment.amount && (x.payment_reference || '') === (payment.payment_reference || ''));
    if (dupe) throw new Error('duplicate key value violates unique constraint (this exact payment is already recorded)');
    DB.payments.push(payment);
    auditInsert('payments', payment);
    if (sched) {
      const before = Object.assign({}, sched);
      const days = (new Date(p.p_transaction_date) - new Date(sched.scheduled_date)) / 86400000;
      sched.status = days < 0 ? 'RECEIVED_EARLY' : days === 0 ? 'RECEIVED_ON_TIME' : 'RECEIVED_LATE';
      sched.actual_payment_id = payment.id;
      auditUpdate('payment_schedule', before, sched);
    }
    const dealBefore = Object.assign({}, deal);
    deal.last_payment_date = p.p_transaction_date;
    deal.current_principal = Math.max(0, deal.current_principal - (p.p_principal_amount || 0));
    auditUpdate('deals', dealBefore, deal);
    if (p.p_principal_amount > 0) {
      const r = { id: genId('reinvestments'), user_id: DEMO_USER.id, source_payment_id: payment.id, returned_amount: p.p_principal_amount, returned_date: p.p_transaction_date, reinvested_amount: null, reinvestment_date: null, new_deal_id: null, reinvestment_destination: null, created_at: nowIso() };
      recomputeReinvestmentColumns(r);
      DB.reinvestments.push(r);
    }
    return payment.id;
  }

  function seed() {
    Object.keys(DB).forEach((k) => { DB[k] = []; });
    Object.keys(counters).forEach((k) => { delete counters[k]; });

    const platformA = { id: genId('platforms'), user_id: DEMO_USER.id, name: 'Sample P2P Platform', investment_type: 'P2P Lending', created_at: nowIso(), updated_at: nowIso() };
    const platformB = { id: genId('platforms'), user_id: DEMO_USER.id, name: 'Sample Bank', investment_type: 'Fixed Income', created_at: nowIso(), updated_at: nowIso() };
    DB.platforms.push(platformA, platformB);
    DB.risk_ratings.push({ id: 1, user_id: null, code: 'LOW', label: 'Low Risk', sort_order: 1, is_system: true }, { id: 2, user_id: null, code: 'MEDIUM', label: 'Medium Risk', sort_order: 2, is_system: true }, { id: 3, user_id: null, code: 'HIGH', label: 'High Risk', sort_order: 3, is_system: true });
    DB.investment_categories.push({ id: 1, user_id: null, investment_type: 'P2P Lending', category: 'P2P', sub_category: 'Consumer Loan', is_system: true }, { id: 2, user_id: null, investment_type: 'Fixed Income', category: 'Fixed Deposit', sub_category: 'Bank FD', is_system: true });
    DB.profiles.push({ id: DEMO_USER.id, email: DEMO_USER.email, full_name: 'Demo User', preferred_currency: 'INR', financial_year_start_month: 4, financial_year_start_day: 1, timezone: 'Asia/Kolkata', is_admin: true, created_at: nowIso(), updated_at: nowIso() });

    const today = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    const deal1Start = new Date(today.getFullYear(), today.getMonth() - 6, 5);
    const deal1Maturity = new Date(today.getFullYear(), today.getMonth() + 6, 5);
    const deal1 = { id: genId('deals'), user_id: DEMO_USER.id, deal_name: 'Sample P2P Deal - 12mo', platform_id: platformA.id, investment_type: 'P2P Lending', category: 'P2P', invested_amount: 50000, principal_amount: 50000, original_principal: 50000, current_principal: 50000, annual_roi: 24, payment_frequency: 'Monthly', payout_type: 'Interest Only', start_date: iso(deal1Start), maturity_date: iso(deal1Maturity), status: 'ACTIVE', risk_rating: 'MEDIUM', expected_total_interest: 12000, fees: 0, tax_withheld: 0, source: 'Manual', created_at: nowIso(), updated_at: nowIso() };
    const deal2Start = new Date(today.getFullYear() - 1, today.getMonth(), 1);
    const deal2Maturity = new Date(today.getFullYear() + 2, today.getMonth(), 1);
    const deal2 = { id: genId('deals'), user_id: DEMO_USER.id, deal_name: 'Sample Bank FD - 36mo', platform_id: platformB.id, investment_type: 'Fixed Income', category: 'Fixed Deposit', invested_amount: 100000, principal_amount: 100000, original_principal: 100000, current_principal: 100000, annual_roi: 7.5, payment_frequency: 'Yearly', payout_type: 'Interest + Principal', start_date: iso(deal2Start), maturity_date: iso(deal2Maturity), status: 'ACTIVE', risk_rating: 'LOW', expected_total_interest: 22500, fees: 0, tax_withheld: 0, source: 'Manual', created_at: nowIso(), updated_at: nowIso() };
    const closedStart = new Date(today.getFullYear() - 1, today.getMonth() - 2, 1);
    const closedMaturity = new Date(today.getFullYear(), today.getMonth() - 2, 1);
    const deal3 = { id: genId('deals'), user_id: DEMO_USER.id, deal_name: 'Sample Closed P2P Deal', platform_id: platformA.id, investment_type: 'P2P Lending', category: 'P2P', invested_amount: 20000, principal_amount: 20000, original_principal: 20000, current_principal: 0, annual_roi: 20, payment_frequency: 'Monthly', payout_type: 'Interest Only', start_date: iso(closedStart), maturity_date: iso(closedMaturity), closure_date: iso(closedMaturity), status: 'CLOSED', risk_rating: 'MEDIUM', expected_total_interest: 4000, fees: 0, tax_withheld: 0, source: 'Manual', created_at: nowIso(), updated_at: nowIso() };
    DB.deals.push(deal1, deal2, deal3);
    deal1.created_at = deal1.updated_at = nowIso();
    [deal1, deal2, deal3].forEach((d) => auditInsert('deals', d));

    generateSchedule(deal1.id);
    generateSchedule(deal2.id);
    generateSchedule(deal3.id);

    for (let i = 6; i >= 1; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 5);
      if (d < deal1Start) continue;
      try { recordPayment({ p_deal_id: deal1.id, p_transaction_date: iso(d), p_amount: 1000, p_interest_amount: 1000, p_principal_amount: 0, p_confirmation_method: 'Manual' }); } catch (e) { /* skip */ }
    }
    for (let i = 12; i >= 1; i--) {
      const d = new Date(closedStart.getFullYear(), closedStart.getMonth() + i - 1, 5);
      if (d > closedMaturity) continue;
      try { recordPayment({ p_deal_id: deal3.id, p_transaction_date: iso(d), p_amount: 333.33, p_interest_amount: 333.33, p_principal_amount: 0, p_confirmation_method: 'Manual' }); } catch (e) { /* skip */ }
    }
    try { recordPayment({ p_deal_id: deal3.id, p_transaction_date: iso(closedMaturity), p_amount: 20000, p_interest_amount: 0, p_principal_amount: 20000, p_confirmation_method: 'Manual' }); } catch (e) { /* skip */ }

    const overdueRow = DB.payment_schedule.find((s) => s.deal_id === deal1.id && s.status === 'UPCOMING' && new Date(s.scheduled_date) < today);
    if (overdueRow) overdueRow.status = 'OVERDUE';

    DB.notification_preferences.push({ user_id: DEMO_USER.id, reminder_offset_days: [-7, -3, -1, 0, 1, 3, 7, 30], channels_enabled: { 'In-app': true }, created_at: nowIso(), updated_at: nowIso() });
    DB.notifications.push({ id: genId('notifications'), user_id: DEMO_USER.id, deal_id: deal1.id, type: 'Payment Overdue', title: 'Payment overdue - ' + deal1.deal_name, message: 'A payment is overdue for this deal.', priority: 'High', channel: 'In-app', status: 'Pending', scheduled_at: nowIso(), created_at: nowIso() });
    DB.portfolio_goals.push({ id: genId('portfolio_goals'), user_id: DEMO_USER.id, label: 'Sample 2026 Goals', target_annual_income: 50000, target_portfolio_size: 300000, target_roi: 15, is_active: true, created_at: nowIso(), updated_at: nowIso() });
  }

  let session = null;
  const authListeners = [];
  function fireAuthChange() { authListeners.forEach((cb) => cb('SIGNED_IN', session)); }
  const auth = {
    async signUp({ email }) { session = { user: { id: DEMO_USER.id, email } }; fireAuthChange(); return { data: { user: session.user, session }, error: null }; },
    async signInWithPassword({ email }) { session = { user: { id: DEMO_USER.id, email } }; fireAuthChange(); return { data: { user: session.user, session }, error: null }; },
    async signOut() { session = null; fireAuthChange(); return { error: null }; },
    async getSession() { return { data: { session } }; },
    onAuthStateChange(cb) { authListeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
  };

  const storageFiles = {};
  const storage = {
    from() {
      return {
        async upload(path, file) { storageFiles[path] = file; return { data: { path }, error: null }; },
        async createSignedUrl(path) { return { data: { signedUrl: 'about:blank#demo-file-' + encodeURIComponent(path) }, error: null }; },
        async remove(paths) { paths.forEach((p) => delete storageFiles[p]); return { data: null, error: null }; },
      };
    },
  };

  function createClient() {
    session = { user: DEMO_USER };
    return {
      auth,
      storage,
      from(table) { return new QB(table); },
      async rpc(fn, params) {
        try {
          if (fn === 'fn_generate_payment_schedule') return { data: generateSchedule(params.p_deal_id), error: null };
          if (fn === 'fn_record_payment') return { data: recordPayment(params), error: null };
          return { data: null, error: { message: 'Unknown demo RPC: ' + fn } };
        } catch (e) { return { data: null, error: { message: e.message } }; }
      },
    };
  }

  return { createClient, seed, DEMO_USER };
})();
