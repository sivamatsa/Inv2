/* Calendar (spec Section 46 nav) - month grid of expected payments and
   maturities, so "what's due when" is visible at a glance rather than only
   as a flat list (which Payments already covers). */
window.App = window.App || {};

(function () {
  let viewMonth = new Date().getMonth();
  let viewYear = new Date().getFullYear();

  async function renderCalendarView() {
    const pane = App.utils.qs('#pane-calendar');
    pane.innerHTML = `
      <div class="section-title">Calendar <div class="line"></div><small>expected payments &amp; maturities by day</small></div>
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <button class="btn btn-outline btn-sm" id="calPrev">&larr; Prev</button>
          <div class="chart-title" id="calLabel"></div>
          <button class="btn btn-outline btn-sm" id="calNext">Next &rarr;</button>
        </div>
        <div id="calGrid"></div>
        <div id="calDayDetail" class="hint"></div>
      </div>`;
    App.utils.qs('#calPrev', pane).addEventListener('click', () => { viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } draw(); });
    App.utils.qs('#calNext', pane).addEventListener('click', () => { viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } draw(); });

    async function draw() {
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      App.utils.qs('#calLabel', pane).textContent = `${monthNames[viewMonth]} ${viewYear}`;

      const rangeStart = App.utils.toISO(new Date(viewYear, viewMonth, 1));
      const rangeEnd = App.utils.toISO(new Date(viewYear, viewMonth + 1, 0));
      const [schedule, deals] = await Promise.all([
        App.api.listSchedule({ gte: { scheduled_date: rangeStart }, lte: { scheduled_date: rangeEnd } }),
        App.api.listDeals({ gte: { maturity_date: rangeStart }, lte: { maturity_date: rangeEnd } }),
      ]);
      const dealsById = {}; deals.forEach((d) => { dealsById[d.id] = d; });
      const byDay = {};
      schedule.forEach((s) => {
        const day = Number(s.scheduled_date.slice(8, 10));
        byDay[day] = byDay[day] || { payments: [], maturities: [] };
        byDay[day].payments.push(s);
      });
      deals.forEach((d) => {
        const day = Number(d.maturity_date.slice(8, 10));
        byDay[day] = byDay[day] || { payments: [], maturities: [] };
        byDay[day].maturities.push(d);
      });

      const firstDow = new Date(viewYear, viewMonth, 1).getDay();
      const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
      const todayStr = App.utils.todayISO();
      const cells = [];
      for (let i = 0; i < firstDow; i++) cells.push('<div></div>');
      for (let day = 1; day <= daysInMonth; day++) {
        const info = byDay[day];
        const dateStr = App.utils.toISO(new Date(viewYear, viewMonth, day));
        const isToday = dateStr === todayStr;
        const total = info ? info.payments.reduce((s, p) => s + (p.expected_total || 0), 0) : 0;
        cells.push(`<div class="chart-card" data-day="${day}" style="padding:8px;min-height:70px;cursor:pointer;${isToday ? 'border-color:var(--gold)' : ''}">
          <div style="font-size:11px;color:${isToday ? 'var(--gold)' : 'var(--text2)'};font-weight:${isToday ? 700 : 500}">${day}</div>
          ${info && info.payments.length ? `<div style="font-size:10.5px;color:var(--teal);margin-top:4px">${App.utils.fmtMoney(total)}</div>` : ''}
          ${info && info.maturities.length ? `<div style="font-size:10px;color:var(--gold);margin-top:2px">${info.maturities.length} maturing</div>` : ''}
        </div>`);
      }
      App.utils.qs('#calGrid', pane).innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;font-size:10px;color:var(--text3);margin-bottom:6px;text-align:center">
          ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div>${d}</div>`).join('')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">${cells.join('')}</div>`;

      App.utils.qsa('[data-day]', pane).forEach((cell) => cell.addEventListener('click', () => {
        const day = Number(cell.dataset.day);
        const info = byDay[day] || { payments: [], maturities: [] };
        const detail = App.utils.qs('#calDayDetail', pane);
        if (!info.payments.length && !info.maturities.length) { detail.innerHTML = 'Nothing scheduled that day.'; return; }
        detail.innerHTML = `<b>${App.utils.fmtDate(new Date(viewYear, viewMonth, day))}</b><br>` +
          info.payments.map((p) => `&bull; Payment expected: ${App.utils.fmtMoney(p.expected_total)} (${(dealsById[p.deal_id] || {}).deal_name || 'deal #' + p.deal_id})`).join('<br>') +
          (info.payments.length && info.maturities.length ? '<br>' : '') +
          info.maturities.map((d) => `&bull; Matures: ${App.utils.escapeHtml(d.deal_name)} (${App.utils.fmtMoney(d.invested_amount)})`).join('<br>');
      }));
    }

    await draw();
  }

  App.router.register('calendar', renderCalendarView);
})();
