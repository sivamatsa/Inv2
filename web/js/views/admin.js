/* Admin (spec Section 2 "Admin/Family/Friend Portfolio Management"). Only
   reachable if profiles.is_admin is true for the signed-in user - enforced
   server-side by RLS (013_admin_role.sql), not just by hiding the nav link.
   Deliberately read-only: this view never edits another user's data, only
   displays it - the underlying RLS grants read access only, same rule. */
window.App = window.App || {};

(function () {
  async function openUserDetailModal(user) {
    const [deals, summary] = await Promise.all([
      App.api.listDeals({ eq: { user_id: user.id } }),
      App.api.getPortfolioSummary(user.id),
    ]);
    const s = summary || {};

    const bodyHtml = `
      <div class="grid-2" style="margin-bottom:14px">
        <div>
          <div class="stat-line"><span>Total Invested</span><span class="v">${App.utils.fmtMoney(s.total_invested)}</span></div>
          <div class="stat-line"><span>Outstanding Principal</span><span class="v">${App.utils.fmtMoney(s.current_outstanding_principal)}</span></div>
          <div class="stat-line"><span>Interest Earned</span><span class="v">${App.utils.fmtMoney(s.interest_earned)}</span></div>
        </div>
        <div>
          <div class="stat-line"><span>Active Deals</span><span class="v">${s.active_deals_count ?? 0}</span></div>
          <div class="stat-line"><span>Closed Deals</span><span class="v">${s.closed_deals_count ?? 0}</span></div>
          <div class="stat-line"><span>Realized ROI</span><span class="v">${App.utils.fmtPct(s.realized_roi)}</span></div>
        </div>
      </div>
      <div class="table-scroll" style="max-height:320px">
        <table class="data"><thead><tr><th>Deal</th><th>Type</th><th>Invested</th><th>ROI</th><th>Status</th><th>Maturity</th></tr></thead>
        <tbody>${deals.map((d) => `<tr>
          <td>${App.utils.escapeHtml(d.deal_name)}</td>
          <td>${App.utils.escapeHtml(d.investment_type)}</td>
          <td>${App.utils.fmtMoney(d.invested_amount)}</td>
          <td>${App.utils.fmtPct(d.annual_roi)}</td>
          <td><span class="badge ${App.utils.statusBadgeClass(d.status)}">${d.status}</span></td>
          <td>${App.utils.fmtDate(d.maturity_date)}</td>
        </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:20px">No deals yet.</td></tr>'}</tbody></table>
      </div>
      <div class="hint">Read-only - admin view never edits another user's data.</div>`;

    App.ui.open({
      title: `${user.full_name || user.email} - Portfolio`,
      bodyHtml,
      actions: [{ label: 'Close', className: 'btn-gold', onClick: App.ui.close }],
    });
  }

  async function renderAdminView() {
    // A non-admin session never renders the admin nav item or its pane div
    // at all (see app.js's currentNavStructure()) - but a stale bookmark or
    // a manually-typed #admin URL can still reach this function directly.
    // The real boundary is RLS either way (a non-admin's queries only ever
    // return their own rows), so this is a UX nicety, not a security check
    // - just bounce back to the dashboard instead of erroring on a pane
    // that doesn't exist in this session's DOM.
    if (!App.state.profile || !App.state.profile.is_admin) {
      App.utils.toast('That section is only visible to admin accounts.', 'err');
      App.router.navigate('dashboard');
      return;
    }
    const pane = App.utils.qs('#pane-admin');

    pane.innerHTML = `
      <div class="section-title">Admin <div class="line"></div><small>read-only view across every registered user</small></div>
      <div class="panel"><div class="table-scroll"><table class="data" id="adminUsersTable"></table></div></div>`;

    const [users, allDeals] = await Promise.all([App.api.listAllProfiles(), App.api.listDeals()]);
    const dealsByUser = {};
    allDeals.forEach((d) => { (dealsByUser[d.user_id] = dealsByUser[d.user_id] || []).push(d); });

    App.utils.qs('#adminUsersTable', pane).innerHTML = `<thead><tr><th>User</th><th>Email</th><th>Joined</th><th>Active Deals</th><th>Total Invested</th><th>Role</th><th>Actions</th></tr></thead>
      <tbody>${users.map((u) => {
        const userDeals = dealsByUser[u.id] || [];
        const activeCount = userDeals.filter((d) => d.status === 'ACTIVE').length;
        const totalInvested = userDeals.reduce((a, d) => a + (d.invested_amount || 0), 0);
        return `<tr>
          <td>${App.utils.escapeHtml(u.full_name || '—')}</td>
          <td>${App.utils.escapeHtml(u.email || '—')}</td>
          <td>${App.utils.fmtDate(u.created_at)}</td>
          <td>${activeCount}</td>
          <td>${App.utils.fmtMoney(totalInvested)}</td>
          <td>${u.is_admin ? '<span class="badge st-active">Admin</span>' : 'User'}</td>
          <td><button class="btn btn-sm btn-outline" data-view-user="${u.id}">View Portfolio</button></td>
        </tr>`;
      }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:20px">No users found.</td></tr>'}</tbody>`;

    App.utils.qsa('[data-view-user]', pane).forEach((b) => b.addEventListener('click', () => {
      const user = users.find((u) => u.id === b.dataset.viewUser);
      openUserDetailModal(user);
    }));
  }

  App.router.register('admin', renderAdminView);
})();
