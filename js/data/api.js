/* The only file that talks to Supabase for data. Every view goes through
   here rather than calling supabase-js directly, so the data access pattern
   stays in one place. */
window.App = window.App || {};

App.api = (function () {
  function client() {
    const c = App.auth.getClient();
    if (!c) throw new Error('Supabase is not connected.');
    return c;
  }

  function uid() {
    const u = App.auth.getUser();
    if (!u) throw new Error('Not signed in.');
    return u.id;
  }

  function check(error) {
    if (error) throw error;
  }

  async function selectAll(table, opts) {
    opts = opts || {};
    let q = client().from(table).select(opts.select || '*');
    if (opts.eq) Object.entries(opts.eq).forEach(([k, v]) => { q = q.eq(k, v); });
    if (opts.in) Object.entries(opts.in).forEach(([k, v]) => { q = q.in(k, v); });
    if (opts.gte) Object.entries(opts.gte).forEach(([k, v]) => { q = q.gte(k, v); });
    if (opts.lte) Object.entries(opts.lte).forEach(([k, v]) => { q = q.lte(k, v); });
    if (opts.order) q = q.order(opts.order.column, { ascending: opts.order.ascending !== false });
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    check(error);
    return data || [];
  }

  async function insertRow(table, row, opts) {
    // Omit null/undefined keys rather than sending them explicitly: several
    // columns are `not null default '...'` (status, confirmation_method,
    // source, ...), and Postgres only applies a column default when it's
    // left out of the insert entirely - an explicit NULL still violates
    // NOT NULL. A form field the user left blank should mean "use the
    // database default", not "store NULL".
    const cleaned = {};
    Object.entries(row || {}).forEach(([k, v]) => { if (v !== null && v !== undefined) cleaned[k] = v; });
    const payload = Object.assign({ user_id: uid() }, cleaned);
    let q = client().from(table).insert(payload).select();
    const { data, error } = (opts && opts.many) ? await q : await q.single();
    check(error);
    return data;
  }

  async function updateRow(table, id, patch, idCol) {
    const { data, error } = await client().from(table).update(patch).eq(idCol || 'id', id).select().single();
    check(error);
    return data;
  }

  async function deleteRow(table, id, idCol) {
    const { error } = await client().from(table).delete().eq(idCol || 'id', id);
    check(error);
  }

  // ---- profiles ----
  async function getProfile() {
    const { data, error } = await client().from('profiles').select('*').eq('id', uid()).maybeSingle();
    check(error);
    return data;
  }
  async function updateProfile(patch) {
    return updateRow('profiles', uid(), patch, 'id');
  }
  // Only returns more than the caller's own row if private.is_admin() says
  // so server-side (013_admin_role.sql) - RLS decides this, not the client.
  async function listAllProfiles() {
    return selectAll('profiles', { order: { column: 'created_at' } });
  }

  // ---- platforms ----
  const listPlatforms = () => selectAll('platforms', { order: { column: 'name' } });
  const createPlatform = (row) => insertRow('platforms', row);
  const updatePlatform = (id, patch) => updateRow('platforms', id, patch);
  const deletePlatform = (id) => deleteRow('platforms', id);

  // ---- lookups ----
  const listCategories = () => selectAll('investment_categories', { order: { column: 'category' } });
  const createCategory = (row) => insertRow('investment_categories', row);
  const listRiskRatings = () => selectAll('risk_ratings', { order: { column: 'sort_order' } });
  const createRiskRating = (row) => insertRow('risk_ratings', row);

  // ---- deals ----
  const listDeals = (opts) => selectAll('deals', Object.assign({ order: { column: 'created_at', ascending: false } }, opts));
  async function getDeal(id) {
    const { data, error } = await client().from('deals').select('*').eq('id', id).single();
    check(error);
    return data;
  }
  const createDeal = (row) => insertRow('deals', row);
  const updateDeal = (id, patch) => updateRow('deals', id, patch);
  const deleteDeal = (id) => deleteRow('deals', id);
  const listDealMetrics = (opts) => selectAll('v_deal_metrics', opts);
  async function getPortfolioSummary(forUserId) {
    const { data, error } = await client().from('v_portfolio_summary').select('*').eq('user_id', forUserId || uid()).maybeSingle();
    check(error);
    return data;
  }

  // ---- payment_schedule ----
  const listSchedule = (opts) => selectAll('payment_schedule', Object.assign({ order: { column: 'scheduled_date' } }, opts));
  const createScheduleRow = (row) => insertRow('payment_schedule', row);
  const updateScheduleRow = (id, patch) => updateRow('payment_schedule', id, patch);
  const deleteScheduleRow = (id) => deleteRow('payment_schedule', id);
  async function generateSchedule(dealId) {
    const { data, error } = await client().rpc('fn_generate_payment_schedule', { p_deal_id: dealId });
    check(error);
    return data;
  }

  // ---- payments ----
  const listPayments = (opts) => selectAll('payments', Object.assign({ order: { column: 'transaction_date', ascending: false } }, opts));
  async function recordPayment(p) {
    const { data, error } = await client().rpc('fn_record_payment', {
      p_deal_id: p.dealId,
      p_transaction_date: p.transactionDate,
      p_amount: p.amount,
      p_interest_amount: p.interestAmount ?? null,
      p_principal_amount: p.principalAmount ?? null,
      p_fee_amount: p.feeAmount ?? 0,
      p_tax_amount: p.taxAmount ?? 0,
      p_payment_reference: p.paymentReference ?? null,
      p_payment_mode: p.paymentMode ?? null,
      p_confirmation_method: p.confirmationMethod ?? 'Manual',
      p_notes: p.notes ?? null,
      p_scheduled_payment_id: p.scheduledPaymentId ?? null,
    });
    check(error);
    return data;
  }
  const voidPayment = (id, reason) => updateRow('payments', id, { is_voided: true, voided_at: new Date().toISOString(), voided_reason: reason || null });

  // ---- reinvestments ----
  const listReinvestments = (opts) => selectAll('reinvestments', Object.assign({ order: { column: 'returned_date', ascending: false } }, opts));
  const updateReinvestment = (id, patch) => updateRow('reinvestments', id, patch);

  // ---- notifications ----
  const listNotifications = (opts) => selectAll('notifications', Object.assign({ order: { column: 'scheduled_at', ascending: false } }, opts));
  const markNotificationRead = (id) => updateRow('notifications', id, { read_at: new Date().toISOString(), status: 'Read' });
  async function markAllNotificationsRead() {
    const { error } = await client().from('notifications').update({ read_at: new Date().toISOString(), status: 'Read' })
      .eq('user_id', uid()).is('read_at', null);
    check(error);
  }
  async function getPreferences() {
    const { data, error } = await client().from('notification_preferences').select('*').eq('user_id', uid()).maybeSingle();
    check(error);
    return data;
  }
  async function upsertPreferences(patch) {
    const { data, error } = await client().from('notification_preferences')
      .upsert(Object.assign({ user_id: uid() }, patch), { onConflict: 'user_id' }).select().single();
    check(error);
    return data;
  }

  // ---- documents (Supabase Storage + metadata row) ----
  const listDocuments = (opts) => selectAll('documents', Object.assign({ order: { column: 'created_at', ascending: false } }, opts));
  async function uploadDocument(file, meta) {
    const path = `${uid()}/${meta.dealId || 'general'}/${Date.now()}_${file.name}`;
    const { error: upErr } = await client().storage.from('documents').upload(path, file);
    check(upErr);
    return insertRow('documents', {
      deal_id: meta.dealId || null,
      payment_id: meta.paymentId || null,
      document_type: meta.documentType,
      document_reference: meta.documentReference || null,
      document_date: meta.documentDate || null,
      notes: meta.notes || null,
      storage_path: path,
      file_name: file.name,
      file_size_bytes: file.size,
      mime_type: file.type,
    });
  }
  async function getDocumentUrl(storagePath) {
    const { data, error } = await client().storage.from('documents').createSignedUrl(storagePath, 300);
    check(error);
    return data.signedUrl;
  }
  async function deleteDocument(id, storagePath) {
    await client().storage.from('documents').remove([storagePath]);
    return deleteRow('documents', id);
  }

  // ---- audit / imports ----
  const listAuditLogs = (opts) => selectAll('audit_logs', Object.assign({ order: { column: 'changed_at', ascending: false }, limit: 500 }, opts));
  const listImports = (opts) => selectAll('imports', Object.assign({ order: { column: 'imported_at', ascending: false } }, opts));
  const createImport = (row) => insertRow('imports', row);
  const updateImport = (id, patch) => updateRow('imports', id, patch);

  // ---- goals / cash / tax ----
  const listGoals = (opts) => selectAll('portfolio_goals', Object.assign({ order: { column: 'created_at', ascending: false } }, opts));
  const createGoal = (row) => insertRow('portfolio_goals', row);
  const updateGoal = (id, patch) => updateRow('portfolio_goals', id, patch);
  const listCashTransactions = (opts) => selectAll('cash_transactions', Object.assign({ order: { column: 'transaction_date', ascending: false } }, opts));
  const createCashTransaction = (row) => insertRow('cash_transactions', row);
  const listTaxRecords = (opts) => selectAll('tax_records', Object.assign({ order: { column: 'financial_year', ascending: false } }, opts));
  const createTaxRecord = (row) => insertRow('tax_records', row);
  const updateTaxRecord = (id, patch) => updateRow('tax_records', id, patch);

  // ---- ai insights / what-if ----
  const listInsights = (opts) => selectAll('ai_insights', Object.assign({ order: { column: 'generated_at', ascending: false }, eq: { is_dismissed: false } }, opts));
  const dismissInsight = (id) => updateRow('ai_insights', id, { is_dismissed: true });
  const listScenarios = () => selectAll('scenario_simulations', { order: { column: 'created_at', ascending: false } });
  const saveScenario = (row) => insertRow('scenario_simulations', row);
  const deleteScenario = (id) => deleteRow('scenario_simulations', id);

  // ---- integrations ----
  const listIntegrations = () => selectAll('integration_configs');
  async function upsertIntegration(integrationType, patch) {
    const { data, error } = await client().from('integration_configs')
      .upsert(Object.assign({ user_id: uid(), integration_type: integrationType }, patch), { onConflict: 'user_id,integration_type' })
      .select().single();
    check(error);
    return data;
  }

  // ---- reconciliation ----
  const listBankTransactions = (opts) => selectAll('bank_transactions', Object.assign({ order: { column: 'transaction_date', ascending: false } }, opts));
  const createBankTransaction = (row) => insertRow('bank_transactions', row);
  const markBankTransactionMatched = (id) => updateRow('bank_transactions', id, { matched: true });
  const listPaymentMatches = (opts) => selectAll('payment_matches', opts);
  const createPaymentMatch = (row) => insertRow('payment_matches', row);
  const updatePaymentMatch = (id, patch) => updateRow('payment_matches', id, patch);

  return {
    getProfile, updateProfile, listAllProfiles,
    listPlatforms, createPlatform, updatePlatform, deletePlatform,
    listCategories, createCategory, listRiskRatings, createRiskRating,
    listDeals, getDeal, createDeal, updateDeal, deleteDeal, listDealMetrics, getPortfolioSummary,
    listSchedule, createScheduleRow, updateScheduleRow, deleteScheduleRow, generateSchedule,
    listPayments, recordPayment, voidPayment,
    listReinvestments, updateReinvestment,
    listNotifications, markNotificationRead, markAllNotificationsRead, getPreferences, upsertPreferences,
    listDocuments, uploadDocument, getDocumentUrl, deleteDocument,
    listAuditLogs, listImports, createImport, updateImport,
    listGoals, createGoal, updateGoal, listCashTransactions, createCashTransaction,
    listTaxRecords, createTaxRecord, updateTaxRecord,
    listInsights, dismissInsight, listScenarios, saveScenario, deleteScenario,
    listIntegrations, upsertIntegration,
    listBankTransactions, createBankTransaction, markBankTransactionMatched,
    listPaymentMatches, createPaymentMatch, updatePaymentMatch,
  };
})();
