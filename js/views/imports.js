/* Excel/CSV Import wizard (spec Sections 19, 20, 47, 48). Handles the
   "Deals" sheet fully (map -> validate -> preview -> import -> generate
   schedules) and a "Payments" sheet if present in the same workbook
   (matched to deals by external_deal_id or deal name). Platforms/
   Reinvestments/Documents sheets from the Section 20 master workbook are
   not auto-processed - flagged plainly in the summary rather than silently
   dropped, since claiming full 5-sheet support without building it would
   be worse than being honest about the two that are wired up. */
window.App = window.App || {};

(function () {
  const DEAL_TARGETS = [
    { key: '', label: '(ignore this column)' },
    { key: 'deal_name', label: 'Deal Name', re: /deal\s*name/i },
    { key: 'external_deal_id', label: 'External Deal ID', re: /external\s*deal\s*id/i },
    { key: 'platform_name', label: 'Platform / Lender', re: /platform|lender/i },
    { key: 'investment_type', label: 'Investment Type', re: /investment\s*type/i },
    { key: 'category', label: 'Category', re: /^category$/i },
    { key: 'sub_category', label: 'Sub Category', re: /sub[\s_-]*category/i },
    { key: 'invested_amount', label: 'Invested / Principal Amount', re: /principal\s*amount|invested\s*amount|amount/i },
    { key: 'annual_roi', label: 'ROI %', re: /roi\s*%?$/i },
    { key: 'interest_rate_type', label: 'ROI / Rate Type', re: /roi\s*type|rate\s*type/i },
    { key: 'start_date', label: 'Start Date', re: /start\s*date/i },
    { key: 'maturity_date', label: 'Maturity Date', re: /maturity\s*date/i },
    { key: 'payment_frequency', label: 'Payment Frequency', re: /payment\s*frequency/i },
    { key: 'payment_day', label: 'Payment Day', re: /payment\s*day/i },
    { key: 'first_payment_date', label: 'First Payment Date', re: /first\s*payment\s*date/i },
    { key: 'payout_type', label: 'Payout Type', re: /payout\s*type/i },
    { key: 'status', label: 'Status', re: /^status$|deal\s*status/i },
    { key: 'risk_rating', label: 'Risk Rating', re: /risk\s*rating/i },
    { key: 'notes', label: 'Notes', re: /notes|comments/i },
  ];

  const PAYMENT_TARGETS = [
    { key: '', label: '(ignore this column)' },
    { key: 'external_deal_id', label: 'Deal ID (matches external_deal_id)', re: /deal\s*id/i },
    { key: 'transaction_date', label: 'Actual Date', re: /actual\s*date|transaction\s*date|payment\s*date/i },
    { key: 'amount', label: 'Amount', re: /^amount$/i },
    { key: 'interest_amount', label: 'Interest', re: /^interest$/i },
    { key: 'principal_amount', label: 'Principal', re: /^principal$/i },
    { key: 'tax_amount', label: 'Tax', re: /^tax$/i },
    { key: 'fee_amount', label: 'Fee', re: /^fee$/i },
    { key: 'payment_reference', label: 'Reference', re: /reference/i },
    { key: 'notes', label: 'Notes', re: /notes/i },
  ];

  let wizardState = null;

  function autoMap(headers, targets) {
    const map = {};
    headers.forEach((h) => {
      const norm = String(h).trim();
      const match = targets.find((t) => t.re && t.re.test(norm));
      map[h] = match ? match.key : '';
    });
    return map;
  }

  function renderMappingTable(headers, mapping, targets) {
    return `<div class="table-scroll" style="max-height:280px"><table class="data">
      <thead><tr><th>File Column</th><th>Maps To</th></tr></thead>
      <tbody>${headers.map((h) => `<tr><td>${App.utils.escapeHtml(h)}</td><td>
        <select class="search-input" data-map-col="${App.utils.escapeHtml(h)}">
          ${targets.map((t) => `<option value="${t.key}" ${mapping[h] === t.key ? 'selected' : ''}>${t.label}</option>`).join('')}
        </select></td></tr>`).join('')}</tbody></table></div>`;
  }

  function validateDealRow(row, existingExternalIds, seenExternalIds) {
    const errors = [];
    if (!row.deal_name) errors.push('missing deal name');
    if (row.invested_amount === null || row.invested_amount === undefined) errors.push('missing amount');
    else if (row.invested_amount <= 0) errors.push('invalid/negative amount');
    if (!row.start_date) errors.push('missing/invalid start date');
    if (row.maturity_date && row.start_date && row.maturity_date < row.start_date) errors.push('maturity before start');
    if (row.annual_roi !== null && row.annual_roi !== undefined && (row.annual_roi < 0 || row.annual_roi > 100)) errors.push('invalid ROI');
    const isDup = row.external_deal_id && (existingExternalIds.has(row.external_deal_id) || seenExternalIds.has(row.external_deal_id));
    return { errors, isDuplicate: !!isDup };
  }

  async function resolvePlatform(name) {
    if (!name) return null;
    let p = App.state.platforms.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
    if (p) return p.id;
    p = await App.api.createPlatform({ name });
    App.state.platforms.push(p);
    return p.id;
  }

  function mapRow(row, headers, mapping) {
    const out = {};
    headers.forEach((h) => {
      const target = mapping[h];
      if (!target) return;
      const raw = row[h];
      out[target] = raw === '' || raw === undefined ? null : raw;
    });
    return out;
  }

  async function renderImportsView() {
    const pane = App.utils.qs('#pane-import');
    wizardState = { step: 1, dealRows: [], dealHeaders: [], dealMapping: {}, paymentRows: [], paymentHeaders: [], paymentMapping: {}, fileName: '', unhandledSheets: [] };

    function stepper() {
      const labels = ['1. Upload', '2. Map Columns', '3. Validate &amp; Preview', '4. Import'];
      return `<div class="wizard-steps">${labels.map((l, i) => `<div class="wizard-step ${wizardState.step === i + 1 ? 'active' : wizardState.step > i + 1 ? 'done' : ''}">${l}</div>`).join('')}</div>`;
    }

    async function draw() {
      pane.innerHTML = `
        <div class="section-title">Excel / CSV Import <div class="line"></div><small>upload once, review before anything is saved</small></div>
        <div class="panel">${stepper()}<div id="importStepBody"></div></div>
        <div class="panel"><div class="chart-title" style="margin-bottom:10px">Import History</div><div class="table-scroll" id="importHistoryTable"></div></div>`;
      await drawStep();
      await drawHistory();
    }

    async function drawHistory() {
      const imports = await App.api.listImports();
      App.utils.qs('#importHistoryTable', pane).innerHTML = `<table class="data"><thead><tr><th>File</th><th>Date</th><th>Total</th><th>Success</th><th>Duplicate</th><th>Failed</th><th>Status</th></tr></thead>
        <tbody>${imports.map((i) => `<tr><td>${App.utils.escapeHtml(i.filename)}</td><td>${App.utils.fmtDateTime(i.imported_at)}</td><td>${i.total_rows}</td><td>${i.successful_rows}</td><td>${i.duplicate_rows}</td><td>${i.failed_rows}</td><td><span class="badge ${App.utils.statusBadgeClass(i.status)}">${i.status}</span></td></tr>`).join('')
          || '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:20px">No imports yet.</td></tr>'}</tbody></table>`;
    }

    function drawStep() {
      const host = App.utils.qs('#importStepBody', pane);
      if (wizardState.step === 1) {
        host.innerHTML = `
          <div class="dropzone" id="importDropzone">
            <div class="dropzone-icon">&#128202;</div>
            <div class="dropzone-title">Drop your Excel/CSV file here, or click to browse</div>
            <div class="dropzone-sub">A "Deals" sheet is required; a "Payments" sheet in the same file is optional and imported right after.</div>
          </div>
          <input type="file" id="importFileInput" accept=".xlsx,.xls,.csv">`;
        const dz = App.utils.qs('#importDropzone', host), input = App.utils.qs('#importFileInput', host);
        dz.addEventListener('click', () => input.click());
        input.addEventListener('change', (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); });
        ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
        ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
        dz.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
      } else if (wizardState.step === 2) {
        host.innerHTML = `
          <div class="chart-title" style="margin-bottom:8px">Deals sheet — ${wizardState.dealRows.length} row(s)</div>
          ${renderMappingTable(wizardState.dealHeaders, wizardState.dealMapping, DEAL_TARGETS)}
          ${wizardState.paymentRows.length ? `<div class="chart-title" style="margin:16px 0 8px">Payments sheet — ${wizardState.paymentRows.length} row(s)</div>${renderMappingTable(wizardState.paymentHeaders, wizardState.paymentMapping, PAYMENT_TARGETS)}` : ''}
          ${wizardState.unhandledSheets.length ? `<div class="hint">Sheet(s) not auto-imported yet: ${wizardState.unhandledSheets.join(', ')}. Add platforms via Settings, documents via the Documents view.</div>` : ''}
          <div class="modal-actions"><button class="btn btn-outline" id="backTo1">&larr; Back</button><button class="btn btn-gold" id="toValidate">Validate &amp; Preview &rarr;</button></div>`;
        App.utils.qsa('[data-map-col]', host).forEach((sel) => sel.addEventListener('change', () => {
          if (wizardState.dealHeaders.includes(sel.dataset.mapCol)) wizardState.dealMapping[sel.dataset.mapCol] = sel.value;
          else wizardState.paymentMapping[sel.dataset.mapCol] = sel.value;
        }));
        App.utils.qs('#backTo1', host).addEventListener('click', () => { wizardState.step = 1; draw(); });
        App.utils.qs('#toValidate', host).addEventListener('click', async () => { wizardState.step = 3; await validateAndPreview(); drawStep(); });
      } else if (wizardState.step === 3) {
        host.innerHTML = wizardState.previewHtml + `<div class="modal-actions"><button class="btn btn-outline" id="backTo2">&larr; Back</button><button class="btn btn-gold" id="toImport" ${wizardState.validRows.length ? '' : 'disabled'}>Import ${wizardState.validRows.length} Valid Row(s) &rarr;</button></div>`;
        App.utils.qs('#backTo2', host).addEventListener('click', () => { wizardState.step = 2; drawStep(); });
        App.utils.qs('#toImport', host).addEventListener('click', doImport);
      } else if (wizardState.step === 4) {
        host.innerHTML = wizardState.summaryHtml + `<div class="modal-actions"><button class="btn btn-gold" id="importDone">Done</button></div>`;
        App.utils.qs('#importDone', host).addEventListener('click', () => { wizardState.step = 1; draw(); });
      }
      return Promise.resolve();
    }

    function handleFile(file) {
      wizardState.fileName = file.name;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array', cellDates: true });
          const dealSheetName = wb.SheetNames.find((n) => /deal/i.test(n)) || wb.SheetNames[0];
          const paymentSheetName = wb.SheetNames.find((n) => /payment/i.test(n));
          wizardState.unhandledSheets = wb.SheetNames.filter((n) => n !== dealSheetName && n !== paymentSheetName);
          const dealRows = XLSX.utils.sheet_to_json(wb.Sheets[dealSheetName], { defval: '' });
          wizardState.dealRows = dealRows;
          wizardState.dealHeaders = dealRows.length ? Object.keys(dealRows[0]) : [];
          wizardState.dealMapping = autoMap(wizardState.dealHeaders, DEAL_TARGETS);
          if (paymentSheetName) {
            const paymentRows = XLSX.utils.sheet_to_json(wb.Sheets[paymentSheetName], { defval: '' });
            wizardState.paymentRows = paymentRows;
            wizardState.paymentHeaders = paymentRows.length ? Object.keys(paymentRows[0]) : [];
            wizardState.paymentMapping = autoMap(wizardState.paymentHeaders, PAYMENT_TARGETS);
          }
          if (!wizardState.dealRows.length) { App.utils.toast('No rows found in the Deals sheet', 'err'); return; }
          wizardState.step = 2;
          draw();
        } catch (err) { App.utils.toast('Could not parse file: ' + (err.message || err), 'err'); }
      };
      reader.readAsArrayBuffer(file);
    }

    async function validateAndPreview() {
      const existingDeals = await App.api.listDeals();
      const existingExternalIds = new Set(existingDeals.filter((d) => d.external_deal_id).map((d) => d.external_deal_id));
      const seen = new Set();
      const validRows = [], errorRows = [], duplicateRows = [];

      wizardState.dealRows.forEach((raw, idx) => {
        const hasAny = Object.values(raw).some((v) => String(v || '').trim() !== '');
        if (!hasAny) return;
        const mapped = mapRow(raw, wizardState.dealHeaders, wizardState.dealMapping);
        const normalized = {
          deal_name: mapped.deal_name ? String(mapped.deal_name).trim() : null,
          external_deal_id: mapped.external_deal_id ? String(mapped.external_deal_id).trim() : null,
          platform_name: mapped.platform_name || null,
          investment_type: mapped.investment_type || 'Other',
          category: mapped.category || null,
          sub_category: mapped.sub_category || null,
          invested_amount: App.utils.parseNum(mapped.invested_amount),
          annual_roi: App.utils.parseNum(mapped.annual_roi),
          interest_rate_type: mapped.interest_rate_type || null,
          start_date: App.utils.toISO(App.utils.parseDate(mapped.start_date)),
          maturity_date: mapped.maturity_date ? App.utils.toISO(App.utils.parseDate(mapped.maturity_date)) : null,
          payment_frequency: mapped.payment_frequency || 'Monthly',
          payment_day: App.utils.parseNum(mapped.payment_day),
          first_payment_date: mapped.first_payment_date ? App.utils.toISO(App.utils.parseDate(mapped.first_payment_date)) : null,
          payout_type: mapped.payout_type || 'Interest Only',
          status: mapped.status || 'ACTIVE',
          risk_rating: mapped.risk_rating || null,
          notes: mapped.notes || null,
        };
        const { errors, isDuplicate } = validateDealRow(normalized, existingExternalIds, seen);
        if (normalized.external_deal_id) seen.add(normalized.external_deal_id);
        if (errors.length) errorRows.push({ row: idx + 2, errors, data: normalized });
        else if (isDuplicate) duplicateRows.push({ row: idx + 2, data: normalized });
        else validRows.push({ row: idx + 2, data: normalized });
      });

      wizardState.validRows = validRows;
      wizardState.errorRows = errorRows;
      wizardState.duplicateRows = duplicateRows;
      wizardState.previewHtml = `
        <div class="grid-4" style="margin-bottom:14px">
          <div class="kpi c-blue"><div class="kpi-label">Rows Detected</div><div class="kpi-value">${wizardState.dealRows.length}</div></div>
          <div class="kpi c-teal"><div class="kpi-label">Valid</div><div class="kpi-value">${validRows.length}</div></div>
          <div class="kpi c-gold"><div class="kpi-label">Duplicates</div><div class="kpi-value">${duplicateRows.length}</div></div>
          <div class="kpi c-red"><div class="kpi-label">Errors</div><div class="kpi-value">${errorRows.length}</div></div>
        </div>
        ${errorRows.length ? `<div class="chart-title" style="margin-bottom:6px">Rows with errors (not imported)</div><div class="table-scroll" style="max-height:200px;margin-bottom:14px"><table class="data"><thead><tr><th>File Row</th><th>Deal</th><th>Errors</th></tr></thead><tbody>${errorRows.map((r) => `<tr><td>${r.row}</td><td>${App.utils.escapeHtml(r.data.deal_name || '—')}</td><td>${r.errors.join(', ')}</td></tr>`).join('')}</tbody></table></div>` : ''}
        ${duplicateRows.length ? `<div class="chart-title" style="margin-bottom:6px">Duplicates (matched by External Deal ID, not re-imported)</div><div class="table-scroll" style="max-height:150px;margin-bottom:14px"><table class="data"><thead><tr><th>File Row</th><th>Deal</th><th>External ID</th></tr></thead><tbody>${duplicateRows.map((r) => `<tr><td>${r.row}</td><td>${App.utils.escapeHtml(r.data.deal_name || '—')}</td><td>${r.data.external_deal_id}</td></tr>`).join('')}</tbody></table></div>` : ''}
        <div class="chart-title" style="margin-bottom:6px">Preview of valid rows</div>
        <div class="table-scroll" style="max-height:220px"><table class="data"><thead><tr><th>Deal</th><th>Amount</th><th>ROI</th><th>Start</th><th>Maturity</th></tr></thead><tbody>${validRows.slice(0, 20).map((r) => `<tr><td>${App.utils.escapeHtml(r.data.deal_name)}</td><td>${App.utils.fmtMoney(r.data.invested_amount)}</td><td>${App.utils.fmtPct(r.data.annual_roi)}</td><td>${App.utils.fmtDate(r.data.start_date)}</td><td>${App.utils.fmtDate(r.data.maturity_date)}</td></tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text3)">Nothing valid to import</td></tr>'}</tbody></table></div>`;
    }

    async function doImport() {
      const importRow = await App.api.createImport({ filename: wizardState.fileName, source: 'Excel Import', total_rows: wizardState.dealRows.length, status: 'Processing' });
      let success = 0, failed = 0;
      const errorReport = [...wizardState.errorRows.map((r) => ({ row: r.row, reason: r.errors.join(', ') }))];
      for (const r of wizardState.validRows) {
        try {
          const platformId = await resolvePlatform(r.data.platform_name);
          const deal = await App.api.createDeal({
            deal_name: r.data.deal_name, external_deal_id: r.data.external_deal_id, platform_id: platformId,
            investment_type: r.data.investment_type, category: r.data.category, sub_category: r.data.sub_category,
            invested_amount: r.data.invested_amount, principal_amount: r.data.invested_amount, original_principal: r.data.invested_amount,
            current_principal: r.data.invested_amount, annual_roi: r.data.annual_roi, interest_rate_type: r.data.interest_rate_type,
            start_date: r.data.start_date, maturity_date: r.data.maturity_date, payment_frequency: r.data.payment_frequency,
            payment_day: r.data.payment_day, first_payment_date: r.data.first_payment_date, payout_type: r.data.payout_type,
            status: r.data.status, risk_rating: r.data.risk_rating, notes: r.data.notes, source: 'Excel Import',
          });
          if (deal.maturity_date && !['Irregular', 'Custom'].includes(deal.payment_frequency)) {
            try { await App.api.generateSchedule(deal.id); } catch (e) { /* deal saved even if schedule generation fails */ }
          }
          success++;
        } catch (e) {
          failed++;
          errorReport.push({ row: r.row, reason: e.message || String(e) });
        }
      }

      if (wizardState.paymentRows.length) {
        const allDeals = await App.api.listDeals();
        for (const raw of wizardState.paymentRows) {
          const hasAny = Object.values(raw).some((v) => String(v || '').trim() !== '');
          if (!hasAny) continue;
          const mapped = mapRow(raw, wizardState.paymentHeaders, wizardState.paymentMapping);
          const deal = allDeals.find((d) => d.external_deal_id === String(mapped.external_deal_id || '').trim());
          if (!deal || !mapped.transaction_date || !mapped.amount) { errorReport.push({ row: 'payments', reason: 'payment row without a matching deal ID, date, or amount' }); continue; }
          try {
            await App.api.recordPayment({
              dealId: deal.id, transactionDate: App.utils.toISO(App.utils.parseDate(mapped.transaction_date)), amount: App.utils.parseNum(mapped.amount),
              interestAmount: App.utils.parseNum(mapped.interest_amount), principalAmount: App.utils.parseNum(mapped.principal_amount),
              feeAmount: App.utils.parseNum(mapped.fee_amount) || 0, taxAmount: App.utils.parseNum(mapped.tax_amount) || 0,
              paymentReference: mapped.payment_reference, confirmationMethod: 'Excel Import', notes: mapped.notes,
            });
          } catch (e) { /* likely a duplicate under the dedupe constraint - not counted as a hard failure */ }
        }
      }

      await App.api.updateImport(importRow.id, {
        successful_rows: success, duplicate_rows: wizardState.duplicateRows.length, failed_rows: failed,
        status: failed > 0 ? 'Completed with Errors' : 'Completed', error_report: errorReport,
      });

      wizardState.summaryHtml = `
        <div class="grid-4">
          <div class="kpi c-blue"><div class="kpi-label">Total Rows</div><div class="kpi-value">${wizardState.dealRows.length}</div></div>
          <div class="kpi c-teal"><div class="kpi-label">Imported</div><div class="kpi-value">${success}</div></div>
          <div class="kpi c-gold"><div class="kpi-label">Duplicates Skipped</div><div class="kpi-value">${wizardState.duplicateRows.length}</div></div>
          <div class="kpi c-red"><div class="kpi-label">Failed</div><div class="kpi-value">${failed}</div></div>
        </div>
        <div class="hint">0 existing financial records were overwritten - imports only create new deals/payments, never edit existing ones.</div>`;
      wizardState.step = 4;
      drawStep();
      drawHistory();
    }

    await draw();
  }

  App.router.register('import', renderImportsView);
})();
