/* Portfolio Dashboard (spec Section 12). KPIs from v_portfolio_summary
   (server-computed, authoritative); cash-flow buckets and "needs attention"
   lists are date-range slices of already-fetched schedule/payment rows -
   presentation slicing, not new financial calculations, so doing it in the
   client here doesn't conflict with spec Section 53. */
window.App = window.App || {};

(function () {
  function fyBounds(profile, which) {
    const startMonth = (profile && profile.financial_year_start_month) || 4;
    const startDay = (profile && profile.financial_year_start_day) || 1;
    const now = new Date();
    let fyStartYear = now.getFullYear();
    const fyStartThisYear = new Date(fyStartYear, startMonth - 1, startDay);
    if (now < fyStartThisYear) fyStartYear--;
    if (which === 'previous') fyStartYear--;
    const start = new Date(fyStartYear, startMonth - 1, startDay);
    const end = new Date(fyStartYear + 1, startMonth - 1, startDay - 1);
    return { start: App.utils.toISO(start), end: App.utils.toISO(end) };
  }

  async function renderDashboardView() {
    const pane = App.utils.qs('#pane-dashboard');
    pane.innerHTML = `
      <div class="section-title">Portfolio Dashboard <div class="line"></div><small>money, then attention, then performance</small></div>
      <div id="dashFilterBar"></div>
      <div class="kpi-grid" id="dashKpis"></div>
      <div class="grid-2">
        <div class="panel"><div class="chart-title" style="margin-bottom:10px">Portfolio Detail</div><div id="dashStatLines"></div></div>
        <div class="panel"><div class="chart-title" style="margin-bottom:10px">Cash Flow</div><div id="dashCashFlow"></div></div>
      </div>
      <div class="panel">
        <div class="chart-title" style="margin-bottom:10px">Needs Your Attention</div>
        <div id="dashAttention"></div>
      </div>`;

    App.filters.renderBar(App.utils.qs('#dashFilterBar'), draw);

    async function draw() {
      const [summary, deals, metrics, schedule, payments] = await Promise.all([
        App.api.getPortfolioSummary(), App.api.listDeals(), App.api.listDealMetrics(),
        App.api.listSchedule(), App.api.listPayments(),
      ]);
      const filteredDeals = App.filters.apply(deals);
      const filteredIds = new Set(filteredDeals.map((d) => d.id));
      const metricsById = {}; metrics.forEach((m) => { metricsById[m.deal_id] = m; });

      const s = summary || {};
      const cards = [
        { cls: 'c-gold', icon: '&#128176;', label: 'Total Invested', value: App.utils.fmtMoney(s.total_invested), desc: `${filteredDeals.length} deal(s) in view` },
        { cls: 'c-blue', icon: '&#128188;', label: 'Outstanding Principal', value: App.utils.fmtMoney(s.current_outstanding_principal), desc: 'Capital still deployed' },
        { cls: 'c-teal', icon: '&#128200;', label: 'Interest Earned', value: App.utils.fmtMoney(s.interest_earned), desc: `${App.utils.fmtMoney(s.interest_pending)} pending` },
        { cls: 'c-purple', icon: '&#128181;', label: 'Total Portfolio Value', value: App.utils.fmtMoney(s.total_portfolio_value), desc: 'Deployed + pending interest' },
        { cls: 'c-gold', icon: '&#11088;', label: 'Net Profit', value: App.utils.fmtMoney(s.net_profit), desc: 'Interest minus fees &amp; tax' },
      ];
      App.utils.qs('#dashKpis', pane).innerHTML = cards.map((c) => `
        <div class="kpi ${c.cls} fade-up">
          <div class="kpi-icon">${c.icon}</div>
          <div class="kpi-label">${c.label}</div>
          <div class="kpi-value">${c.value}</div>
          <div class="kpi-desc">${c.desc}</div>
        </div>`).join('');

      App.utils.qs('#dashStatLines', pane).innerHTML = `
        <div class="stat-line"><span>Principal Returned</span><span class="v">${App.utils.fmtMoney(s.principal_returned)}</span></div>
        <div class="stat-line"><span>Expected Future Interest</span><span class="v">${App.utils.fmtMoney(s.expected_future_interest)}</span></div>
        <div class="stat-line"><span>Realized ROI</span><span class="v">${App.utils.fmtPct(s.realized_roi)}</span></div>
        <div class="stat-line"><span>Annualized ROI</span><span class="v">${App.utils.fmtPct(s.annualized_roi)}</span></div>
        <div class="stat-line"><span>Weighted Avg ROI (active)</span><span class="v">${App.utils.fmtPct(s.weighted_average_roi)}</span></div>
        <div class="stat-line"><span>Active / Closed Deals</span><span class="v">${s.active_deals_count || 0} / ${s.closed_deals_count || 0}</span></div>
      `;

      const todayISO = App.utils.todayISO();
      const in7 = App.utils.toISO(new Date(Date.now() + 7 * 86400000));
      const in30 = App.utils.toISO(new Date(Date.now() + 30 * 86400000));
      const in90 = App.utils.toISO(new Date(Date.now() + 90 * 86400000));
      const monthStart = App.utils.toISO(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
      const relevantSchedule = schedule.filter((sc) => filteredIds.has(sc.deal_id));
      const relevantPayments = payments.filter((p) => filteredIds.has(p.deal_id) && !p.is_voided);
      const sumWhere = (rows, dateKey, amtKey, from, to) => rows.filter((r) => r[dateKey] >= from && r[dateKey] <= to).reduce((acc, r) => acc + (r[amtKey] || 0), 0);
      const pendingStatuses = ['UPCOMING', 'DUE_TODAY', 'OVERDUE'];
      const thisMonthReceived = sumWhere(relevantPayments, 'transaction_date', 'amount', monthStart, todayISO);
      const thisMonthExpected = sumWhere(relevantSchedule, 'scheduled_date', 'expected_total', monthStart, App.utils.toISO(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)));
      const thisMonthPending = relevantSchedule.filter((sc) => pendingStatuses.includes(sc.status) && sc.scheduled_date >= monthStart).reduce((a, r) => a + (r.expected_total || 0), 0);
      const fyCur = fyBounds(App.state.profile, 'current');
      const fyPrev = fyBounds(App.state.profile, 'previous');

      App.utils.qs('#dashCashFlow', pane).innerHTML = `
        <div class="stat-line"><span>This Month Received</span><span class="v">${App.utils.fmtMoney(thisMonthReceived)}</span></div>
        <div class="stat-line"><span>This Month Expected</span><span class="v">${App.utils.fmtMoney(thisMonthExpected)}</span></div>
        <div class="stat-line"><span>This Month Pending</span><span class="v">${App.utils.fmtMoney(thisMonthPending)}</span></div>
        <div class="stat-line"><span>Next 7 Days</span><span class="v">${App.utils.fmtMoney(sumWhere(relevantSchedule.filter((r) => pendingStatuses.includes(r.status)), 'scheduled_date', 'expected_total', todayISO, in7))}</span></div>
        <div class="stat-line"><span>Next 30 Days</span><span class="v">${App.utils.fmtMoney(sumWhere(relevantSchedule.filter((r) => pendingStatuses.includes(r.status)), 'scheduled_date', 'expected_total', todayISO, in30))}</span></div>
        <div class="stat-line"><span>Next 90 Days</span><span class="v">${App.utils.fmtMoney(sumWhere(relevantSchedule.filter((r) => pendingStatuses.includes(r.status)), 'scheduled_date', 'expected_total', todayISO, in90))}</span></div>
        <div class="stat-line"><span>Current FY (${fyCur.start.slice(0, 4)})</span><span class="v">${App.utils.fmtMoney(sumWhere(relevantPayments, 'transaction_date', 'amount', fyCur.start, fyCur.end))}</span></div>
        <div class="stat-line"><span>Previous FY</span><span class="v">${App.utils.fmtMoney(sumWhere(relevantPayments, 'transaction_date', 'amount', fyPrev.start, fyPrev.end))}</span></div>
      `;

      const dueToday = relevantSchedule.filter((sc) => sc.scheduled_date === todayISO && pendingStatuses.includes(sc.status));
      const overdue = relevantSchedule.filter((sc) => sc.status === 'OVERDUE');
      const maturing30 = filteredDeals.filter((d) => d.maturity_date && d.maturity_date >= todayISO && d.maturity_date <= in30 && d.status === 'ACTIVE');
      const largeThreshold = relevantSchedule.length ? [...relevantSchedule].map((r) => r.expected_total || 0).sort((a, b) => a - b)[Math.floor(relevantSchedule.length * 0.9)] : 0;
      const largeUpcoming = relevantSchedule.filter((sc) => pendingStatuses.includes(sc.status) && (sc.expected_total || 0) >= largeThreshold && largeThreshold > 0);
      const poorReliability = filteredDeals.filter((d) => { const m = metricsById[d.id]; return m && m.payout_reliability !== null && m.payout_reliability < 70; });

      const dealsById = {}; deals.forEach((d) => { dealsById[d.id] = d; });
      function listBlock(title, rows, render) {
        return `<div style="margin-bottom:14px"><div style="font-size:12px;font-weight:600;color:var(--text2);margin-bottom:6px">${title} (${rows.length})</div>
          ${rows.length ? rows.slice(0, 6).map(render).join('') : '<div class="empty-note" style="padding:8px 0">None</div>'}</div>`;
      }
      App.utils.qs('#dashAttention', pane).innerHTML = `
        <div class="grid-4">
          <div>${listBlock('Payments Due Today', dueToday, (r) => `<div class="risk-item"><div class="risk-dot" style="background:var(--gold)"></div><div><div class="risk-name">${App.utils.escapeHtml((dealsById[r.deal_id] || {}).deal_name)}</div><div class="risk-desc">${App.utils.fmtMoney(r.expected_total)}</div></div></div>`)}</div>
          <div>${listBlock('Overdue Payments', overdue, (r) => `<div class="risk-item"><div class="risk-dot" style="background:var(--red)"></div><div><div class="risk-name">${App.utils.escapeHtml((dealsById[r.deal_id] || {}).deal_name)}</div><div class="risk-desc">${App.utils.fmtMoney(r.expected_total)} since ${App.utils.fmtDate(r.scheduled_date)}</div></div></div>`)}</div>
          <div>${listBlock('Maturing in 30 Days', maturing30, (d) => `<div class="risk-item"><div class="risk-dot" style="background:var(--blue)"></div><div><div class="risk-name">${App.utils.escapeHtml(d.deal_name)}</div><div class="risk-desc">${App.utils.fmtDate(d.maturity_date)}</div></div></div>`)}</div>
          <div>${listBlock('Poor Reliability', poorReliability, (d) => `<div class="risk-item"><div class="risk-dot" style="background:var(--purple)"></div><div><div class="risk-name">${App.utils.escapeHtml(d.deal_name)}</div><div class="risk-desc">${App.utils.fmtPct(metricsById[d.id].payout_reliability, 0)} reliable</div></div></div>`)}</div>
        </div>
        ${largeUpcoming.length ? listBlock('Large Upcoming Payments', largeUpcoming, (r) => `<div class="risk-item"><div class="risk-dot" style="background:var(--gold)"></div><div><div class="risk-name">${App.utils.escapeHtml((dealsById[r.deal_id] || {}).deal_name)}</div><div class="risk-desc">${App.utils.fmtMoney(r.expected_total)} on ${App.utils.fmtDate(r.scheduled_date)}</div></div></div>`) : ''}
      `;
    }

    await draw();
  }

  App.router.register('dashboard', renderDashboardView);
})();
