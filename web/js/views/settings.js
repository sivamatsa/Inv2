/* Settings (spec Section 46 nav) - profile (Section 3), notification
   preferences (Section 10), platforms, and the Section 50 "future
   integrations" interface stubs. */
window.App = window.App || {};

(function () {
  const PROFILE_FIELDS = [
    { key: 'full_name', label: 'Full Name' },
    { key: 'mobile', label: 'Mobile' },
    { key: 'city', label: 'City' },
    { key: 'country', label: 'Country' },
    { key: 'preferred_currency', label: 'Preferred Currency', placeholder: 'INR' },
    { key: 'timezone', label: 'Timezone', placeholder: 'Asia/Kolkata' },
    { key: 'financial_year_start_month', label: 'FY Start Month (1-12)', type: 'number' },
    { key: 'financial_year_start_day', label: 'FY Start Day', type: 'number' },
  ];

  const INTEGRATIONS = ['Lender/Platform API', 'Bank Statement Import', 'Open Banking', 'Email Statement Parsing',
    'SMS Transaction Parsing', 'Telegram', 'WhatsApp', 'Push Notifications', 'Google Calendar', 'Email', 'Accounting/Tax Software'];

  async function renderSettingsView() {
    const pane = App.utils.qs('#pane-settings');
    pane.innerHTML = `
      <div class="section-title">Settings <div class="line"></div><small>profile, reminders, platforms, integrations</small></div>
      <div class="panel">
        <div class="chart-title" style="margin-bottom:10px">Profile</div>
        <div id="profileFormHost"></div>
        <div class="modal-actions" style="justify-content:flex-start"><button class="btn btn-gold" id="saveProfileBtn">Save Profile</button></div>
      </div>
      <div class="panel">
        <div class="chart-title" style="margin-bottom:10px">Reminder Preferences</div>
        <div class="hint" style="margin-bottom:10px">Default offsets (days relative to a due date; negative = before, positive = overdue): -7, -3, -1, 0, 1, 3, 7, 30 (spec Section 10).</div>
        <div class="field span2"><label>Reminder Offsets (comma-separated days)</label><input class="search-input" id="offsetsInput" style="width:100%"></div>
        <div class="modal-actions" style="justify-content:flex-start"><button class="btn btn-gold btn-sm" id="savePrefsBtn">Save Preferences</button></div>
      </div>
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div class="chart-title">Platforms</div>
          <button class="btn btn-outline btn-sm" id="addPlatformBtn">+ Add Platform</button>
        </div>
        <div class="table-scroll"><table class="data" id="platformsTable"></table></div>
      </div>
      <div class="panel">
        <div class="chart-title" style="margin-bottom:4px">Future Integrations</div>
        <div class="hint" style="margin-bottom:12px">Interfaces exist for these (spec Section 50); none call an external service yet since that needs credentials and a server-side secret this build doesn't have. Status shown reflects what's actually wired up, not aspirational.</div>
        <div class="card-row" id="integrationsList"></div>
      </div>`;

    const profile = await App.api.getProfile();
    App.utils.qs('#profileFormHost', pane).innerHTML = App.ui.renderForm(PROFILE_FIELDS, profile || {});
    App.utils.qs('#saveProfileBtn', pane).addEventListener('click', async () => {
      const { values } = App.ui.readForm(PROFILE_FIELDS);
      try { await App.api.updateProfile(values); App.state.profile = await App.api.getProfile(); App.utils.toast('Profile saved'); }
      catch (e) { App.utils.toast('Could not save profile: ' + (e.message || e), 'err'); }
    });

    const prefs = await App.api.getPreferences();
    App.utils.qs('#offsetsInput', pane).value = (prefs && prefs.reminder_offset_days ? prefs.reminder_offset_days : [-7, -3, -1, 0, 1, 3, 7, 30]).join(', ');
    App.utils.qs('#savePrefsBtn', pane).addEventListener('click', async () => {
      const offsets = App.utils.qs('#offsetsInput', pane).value.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
      try { await App.api.upsertPreferences({ reminder_offset_days: offsets }); App.utils.toast('Preferences saved'); }
      catch (e) { App.utils.toast('Could not save preferences: ' + (e.message || e), 'err'); }
    });

    async function drawPlatforms() {
      const platforms = await App.api.listPlatforms();
      App.utils.qs('#platformsTable', pane).innerHTML = `<thead><tr><th>Name</th><th>Account Reference</th><th>Investment Type</th><th>Actions</th></tr></thead>
        <tbody>${platforms.map((p) => `<tr><td>${App.utils.escapeHtml(p.name)}</td><td>${App.utils.escapeHtml(p.account_reference || '—')}</td><td>${App.utils.escapeHtml(p.investment_type || '—')}</td>
          <td><button class="icon-btn del" data-del-platform="${p.id}">&#128465;</button></td></tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:16px">No platforms yet.</td></tr>'}</tbody>`;
      App.utils.qsa('[data-del-platform]', pane).forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('Delete this platform? Deals referencing it will keep their history but show no platform.')) return;
        await App.api.deletePlatform(Number(b.dataset.delPlatform));
        App.state.platforms = await App.api.listPlatforms();
        drawPlatforms();
      }));
    }
    App.utils.qs('#addPlatformBtn', pane).addEventListener('click', async () => {
      const name = prompt('Platform / lender name:');
      if (!name) return;
      await App.api.createPlatform({ name });
      App.state.platforms = await App.api.listPlatforms();
      drawPlatforms();
    });
    await drawPlatforms();

    async function drawIntegrations() {
      const configs = await App.api.listIntegrations();
      const byType = {}; configs.forEach((c) => { byType[c.integration_type] = c; });
      App.utils.qs('#integrationsList', pane).innerHTML = INTEGRATIONS.map((name) => {
        const c = byType[name];
        return `<div class="integration-card"><div class="name">${name}</div><div class="status">${c ? c.status : 'Not Connected'}</div></div>`;
      }).join('');
    }
    await drawIntegrations();
  }

  App.router.register('settings', renderSettingsView);
})();
