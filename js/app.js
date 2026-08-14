/* Bootstraps auth, sidebar nav, and the router. Loaded last, after every
   view module has registered itself with App.router. */
window.App = window.App || {};

const NAV_STRUCTURE = [
  { group: 'Overview', items: [
    { key: 'dashboard', label: 'Dashboard', icon: '&#9670;' },
  ] },
  { group: 'Financial Engine', items: [
    { key: 'deals', label: 'Deals', icon: '&#128188;' },
    { key: 'payments', label: 'Payments', icon: '&#128179;' },
    { key: 'calendar', label: 'Calendar', icon: '&#128197;' },
  ] },
  { group: 'Planning', items: [
    { key: 'maturity', label: 'Maturity Planner', icon: '&#8987;' },
    { key: 'reinvestments', label: 'Reinvestments', icon: '&#128260;' },
    { key: 'goals', label: 'Goals', icon: '&#127919;' },
    { key: 'whatif', label: 'What-If & Compare', icon: '&#128202;' },
  ] },
  { group: 'Insights', items: [
    { key: 'analytics', label: 'Analytics', icon: '&#128200;' },
    { key: 'earnings', label: 'Earnings', icon: '&#128176;' },
    { key: 'risk', label: 'Risk Analysis', icon: '&#9888;' },
    { key: 'reports', label: 'Reports (Tax / FY)', icon: '&#128203;' },
  ] },
  { group: 'Records', items: [
    { key: 'import', label: 'Import', icon: '&#128228;' },
    { key: 'documents', label: 'Documents', icon: '&#128193;' },
    { key: 'audit', label: 'Audit History', icon: '&#128269;' },
  ] },
  { group: 'Account', items: [
    { key: 'settings', label: 'Settings', icon: '&#9881;' },
  ] },
];

function currentNavStructure() {
  // Admin is only added to the nav (and only rendered as a working view -
  // see admin.js's own is_admin check) when the signed-in profile is an
  // admin. The real gate is server-side RLS (013_admin_role.sql); this is
  // just so a regular user never even sees a link to a section that
  // wouldn't show them anything anyway.
  const isAdmin = App.state.profile && App.state.profile.is_admin;
  if (!isAdmin) return NAV_STRUCTURE;
  return NAV_STRUCTURE.concat([{ group: 'Admin', items: [{ key: 'admin', label: 'Admin', icon: '&#128081;' }] }]);
}

function renderSidebar() {
  const structure = currentNavStructure();
  const nav = App.utils.qs('#sidebarNav');
  nav.innerHTML = structure.map((g) => `
    <div class="nav-group-label">${g.group}</div>
    ${g.items.map((it) => `
      <div class="nav-link" data-nav="${it.key}" data-label="${it.label}">
        <span class="ic">${it.icon}</span><span>${it.label}</span><span class="nav-badge" id="badge-${it.key}" style="display:none"></span>
      </div>`).join('')}
  `).join('');
  App.utils.qsa('.nav-link', nav).forEach((link) => {
    link.addEventListener('click', () => App.router.navigate(link.dataset.nav));
  });
  App.utils.qs('#viewContainer').innerHTML = structure.flatMap((g) => g.items).map((it) =>
    `<div class="view-pane" data-view="${it.key}" id="pane-${it.key}"></div>`).join('');
}

async function refreshNotificationBadge() {
  try {
    const unread = await App.api.listNotifications({ eq: { status: 'Pending' } });
    ['badge-dashboard', 'bellBadge'].forEach((id) => {
      const el = App.utils.qs('#' + id);
      if (!el) return;
      if (unread.length) { el.style.display = 'inline-block'; el.textContent = unread.length > 99 ? '99+' : unread.length; }
      else el.style.display = 'none';
    });
  } catch (e) { /* non-fatal */ }
}

/* Notification center (spec Section 11) - a bell in the topbar rather than
   its own nav item, since it's a cross-cutting inbox, not a distinct
   feature area with its own filters/charts. */
async function openNotificationPanel() {
  const notifications = await App.api.listNotifications({ limit: 100 });
  const rowHtml = (n) => `
    <div class="risk-item" style="${n.read_at ? 'opacity:.5' : ''}">
      <div class="risk-dot" style="background:${n.priority === 'Urgent' || n.priority === 'High' ? 'var(--red)' : n.priority === 'Medium' ? 'var(--gold)' : 'var(--blue)'}"></div>
      <div style="flex:1"><div class="risk-name">${App.utils.escapeHtml(n.title)}</div><div class="risk-desc">${App.utils.escapeHtml(n.message)}</div>
        <div class="risk-desc" style="margin-top:2px">${App.utils.fmtDateTime(n.scheduled_at)}</div></div>
      ${n.read_at ? '' : `<button class="icon-btn" data-mark-read="${n.id}" title="Mark read">&#10003;</button>`}
    </div>`;
  App.ui.open({
    title: 'Notifications',
    bodyHtml: `<div style="max-height:60vh;overflow:auto">${notifications.map(rowHtml).join('') || '<div class="empty-note">No notifications yet.</div>'}</div>`,
    actions: [
      { label: 'Mark All Read', className: 'btn-outline', onClick: async () => { await App.api.markAllNotificationsRead(); App.ui.close(); refreshNotificationBadge(); } },
      { label: 'Close', className: 'btn-gold', onClick: App.ui.close },
    ],
    onMount: (body) => {
      App.utils.qsa('[data-mark-read]', body).forEach((b) => b.addEventListener('click', async () => {
        await App.api.markNotificationRead(Number(b.dataset.markRead));
        refreshNotificationBadge();
        openNotificationPanel();
      }));
    },
  });
}

async function enterApp() {
  App.utils.qs('#authScreen').style.display = 'none';
  App.utils.qs('#appShell').classList.add('active');
  const user = App.auth.getUser();
  const isDemo = App.auth.isDemoMode();
  App.utils.qs('#userChipEmail').textContent = isDemo ? 'Demo Mode' : (user ? user.email : '');
  App.utils.qs('#demoBanner').style.display = isDemo ? 'flex' : 'none';
  App.utils.qs('#signOutBtn').textContent = isDemo ? 'Exit Demo' : 'Sign Out';
  try {
    await App.lookups.loadAll();
  } catch (e) {
    App.utils.toast('Could not load account data: ' + (e.message || e), 'err');
  }
  renderSidebar();
  App.router.init();
  refreshNotificationBadge();
  setInterval(refreshNotificationBadge, 60000);
}

function showAuthScreen() {
  App.utils.qs('#appShell').classList.remove('active');
  App.utils.qs('#authScreen').style.display = 'flex';
}

function wireAuthScreen() {
  const setupPane = App.utils.qs('#authSetupPane');
  const formsPane = App.utils.qs('#authFormsPane');

  function refreshSetupVisibility() {
    const configured = App.auth.isConfigured();
    setupPane.style.display = configured ? 'none' : 'block';
    formsPane.style.display = configured ? 'block' : 'none';
    if (configured) App.auth.init();
  }

  App.utils.qs('#saveSupabaseConfig').addEventListener('click', () => {
    const url = App.utils.qs('#cfgUrl').value.trim().replace(/\/$/, '');
    const key = App.utils.qs('#cfgKey').value.trim();
    const errEl = App.utils.qs('#setupError');
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) || !key) {
      errEl.textContent = 'Enter a valid Supabase Project URL and publishable/anon key.';
      return;
    }
    errEl.textContent = '';
    App.auth.saveConfig(url, key);
    refreshSetupVisibility();
    App.utils.toast('Supabase connection saved');
  });

  App.utils.qs('#authTabSignIn').addEventListener('click', () => switchAuthTab('signin'));
  App.utils.qs('#authTabSignUp').addEventListener('click', () => switchAuthTab('signup'));
  App.utils.qs('#changeConnection').addEventListener('click', () => {
    App.auth.clearConfig();
    refreshSetupVisibility();
  });
  App.utils.qs('#tryDemoBtn').addEventListener('click', () => App.auth.enterDemoMode());

  function switchAuthTab(tab) {
    App.utils.qs('#authTabSignIn').classList.toggle('active', tab === 'signin');
    App.utils.qs('#authTabSignUp').classList.toggle('active', tab === 'signup');
    App.utils.qs('#signInForm').style.display = tab === 'signin' ? 'block' : 'none';
    App.utils.qs('#signUpForm').style.display = tab === 'signup' ? 'block' : 'none';
  }

  App.utils.qs('#signInBtn').addEventListener('click', async () => {
    const email = App.utils.qs('#signInEmail').value.trim();
    const password = App.utils.qs('#signInPassword').value;
    const errEl = App.utils.qs('#signInError');
    errEl.textContent = '';
    try {
      await App.auth.signIn(email, password);
    } catch (e) { errEl.textContent = e.message || 'Could not sign in.'; }
  });

  App.utils.qs('#signUpBtn').addEventListener('click', async () => {
    const email = App.utils.qs('#signUpEmail').value.trim();
    const password = App.utils.qs('#signUpPassword').value;
    const name = App.utils.qs('#signUpName').value.trim();
    const errEl = App.utils.qs('#signUpError');
    errEl.textContent = '';
    if (password.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; return; }
    try {
      const res = await App.auth.signUp(email, password, name);
      if (!res.session) {
        errEl.style.color = 'var(--teal)';
        errEl.textContent = 'Account created. Check your email to confirm it, then sign in.';
      }
    } catch (e) { errEl.textContent = e.message || 'Could not create account.'; }
  });

  App.utils.qs('#signOutBtn').addEventListener('click', () => App.auth.signOut());

  refreshSetupVisibility();
}

document.addEventListener('DOMContentLoaded', () => {
  wireAuthScreen();
  App.utils.qs('#notifBell').addEventListener('click', openNotificationPanel);
  App.auth.onChange((user) => {
    if (user) enterApp(); else showAuthScreen();
  });
  if (App.auth.isConfigured()) App.auth.init();
});
