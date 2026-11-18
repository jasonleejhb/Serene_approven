// --- Audits & Quotes Workflow Modal (Slick, Automated Dev Module) ---
let wfLookups = null;
let wfCurrentId = null;
let wfCurrentData = null;
let wfRates = null;
let wfDistances = [];
let wfCostings = [];
let wfQuote = {};
let wfQuoteTransactions = [];

function _wfEsc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _wfDateVal(v) {
  if (!v) return '';
  const s = String(v);
  return s.length >= 10 ? s.substring(0, 10) : s;
}

function _wfNum(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function _wfEur(v) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(_wfNum(v));
}

async function ensureWorkflowLookups() {
  if (wfLookups) return wfLookups;
  const resp = await fetch('/api/workflows/lookups');
  if (resp.status === 401) { window.location.href = '/login'; return null; }
  if (!resp.ok) throw new Error('Failed to load workflow lookups');
  wfLookups = await resp.json();
  const dl = document.getElementById('wfProductCodesList');
  if (dl && Array.isArray(wfLookups.product_codes)) {
    dl.innerHTML = wfLookups.product_codes.map(p =>
      `<option value="${_wfEsc(p.Code)}">${_wfEsc(p.Omschrijving || '')} | ${_wfEsc(p.Tegenrekening || '')}</option>`
    ).join('');
  }
  return wfLookups;
}

function switchWorkflowTab(tabId) {
  document.querySelectorAll('#workflowModal .wf-tab-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-wf-tab') === tabId);
  });
  document.querySelectorAll('#workflowModal .wf-tab-pane').forEach(p => {
    p.style.display = (p.id === tabId) ? 'block' : 'none';
  });
  if (tabId === 'wfTabTestCosting') {
    renderTestCostingTab();
  }
}

let wfInitialSnapshot = null;
let wfTestFlightCosts = {};
let wfTestSort = { col: 'total', dir: 'asc' };

function closeWorkflowModal(force = false) {
  if (!force && wfInitialSnapshot !== null) {
    const currentSnapshot = JSON.stringify(_collectWorkflowPayload());
    if (currentSnapshot !== wfInitialSnapshot) {
      if (!confirm('You have unsaved changes. If you close without saving, you will lose these changes. Continue?')) {
        return;
      }
    }
  }
  wfInitialSnapshot = null;
  const modal = document.getElementById('workflowModal');
  if (modal) modal.style.display = 'none';
}

async function openWorkflowModal(wfid = null) {
  wfInitialSnapshot = null;
  wfTestFlightCosts = {};
  wfTestSort = { col: 'total', dir: 'asc' };
  const modal = document.getElementById('workflowModal');
  if (!modal) return;
  modal.style.display = 'flex';
  switchWorkflowTab('wfTabDetails');

  try {
    await ensureWorkflowLookups();
    populateWorkflowDropdowns();

    wfCurrentId = wfid;
    if (wfid) {
      const resp = await fetch(`/api/workflows/${wfid}`);
      if (resp.status === 401) { window.location.href = '/login'; return; }
      if (!resp.ok) throw new Error('Failed to load workflow');
      const data = await resp.json();
      wfCurrentData = data.workflow;
      wfDistances = data.distances || [];
      wfCostings = data.costings || [];
      wfQuote = data.quote || { Quote_Status: 'Preparing' };
      wfQuoteTransactions = data.quote_transactions || [];
      wfRates = data.rates || {};
    } else {
      const validTill = new Date();
      validTill.setDate(validTill.getDate() + 14);
      wfCurrentData = {
        Status: 'Pending',
        Single_Multi_Prog: 'Single',
        Single_Multi_Site: 'Single',
        Announcement: 'Announced',
        Nr_Sites: 1,
        AuditorsRequired: 1
      };
      wfDistances = [];
      wfCostings = JSON.parse(JSON.stringify(wfLookups.costing_template || []));
      wfQuote = { Quote_Status: 'Preparing', Quote_ValidTo: validTill.toISOString().substring(0, 10) };
      wfQuoteTransactions = [];
      wfRates = await refreshWorkflowRates(false);
    }

    bindWorkflowForm();
    renderWorkflowRatesBanner();
    renderWorkflowDistancesTable();
    recalcWorkflowCostings(false);
    renderWorkflowCostingsTable();
    renderWorkflowQuoteTab();
    wfInitialSnapshot = JSON.stringify(_collectWorkflowPayload());
  } catch (err) {
    console.error(err);
    alert('Error opening Audit / Quote: ' + err.message);
  }
}

function populateWorkflowDropdowns() {
  if (!wfLookups) return;

  const cbSel = document.getElementById('wfCB');
  if (cbSel) {
    cbSel.innerHTML = '<option value="">-- Select Certification Body --</option>' +
      wfLookups.certification_bodies.map(c => `<option value="${c.ID}">${_wfEsc(c.Company_Name)}</option>`).join('');
  }

  const audSel = document.getElementById('wfAuditee');
  if (audSel) {
    audSel.innerHTML = '<option value="">-- Select Auditee --</option>' +
      wfLookups.auditees.map(a => `<option value="${a.ID}">${_wfEsc(a.Company_Name)}</option>`).join('');
  }

  const progSel = document.getElementById('wfProgram');
  if (progSel) {
    progSel.innerHTML = '<option value="">-- Select Program --</option>' +
      wfLookups.programs.map(p => `<option value="${_wfEsc(p)}">${_wfEsc(p)}</option>`).join('');
  }

  const typeSel = document.getElementById('wfAuditType');
  if (typeSel) {
    typeSel.innerHTML = '<option value="">-- Select Type --</option>' +
      wfLookups.audit_types.map(t => `<option value="${_wfEsc(t)}">${_wfEsc(t)}</option>`).join('');
  }

  const annSel = document.getElementById('wfAnnouncement');
  if (annSel) {
    annSel.innerHTML = '<option value="">-- Select --</option>' +
      wfLookups.announcements.map(a => `<option value="${_wfEsc(a)}">${_wfEsc(a)}</option>`).join('');
  }

  const audOpts = '<option value="">-- Unassigned --</option>' +
    wfLookups.auditors.map(a => `<option value="${a.AuditorID}">${_wfEsc((a.First_Name || '') + ' ' + (a.Last_Name || ''))}</option>`).join('');
  ['wfAuditor1', 'wfAuditor2', 'wfAuditor3', 'wfWitnessAuditor'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = audOpts;
  });
}

function filterWorkflowSitesByAuditee(selectedSiteId = null) {
  const auditeeId = document.getElementById('wfAuditee')?.value;
  const siteSel = document.getElementById('wfSite');
  if (!siteSel || !wfLookups) return;

  const filtered = auditeeId
    ? wfLookups.sites.filter(s => String(s.AuditeeID) === String(auditeeId))
    : wfLookups.sites;

  siteSel.innerHTML = '<option value="">-- Select Site to be Audited --</option>' +
    filtered.map(s => {
      const label = [s.SiteName, s.Address, s.Country].filter(Boolean).join(' — ');
      return `<option value="${s.ID}">${_wfEsc(label)}</option>`;
    }).join('');

  if (selectedSiteId) {
    siteSel.value = String(selectedSiteId);
  } else if (filtered.length === 1) {
    siteSel.value = String(filtered[0].ID);
  }
}

async function refreshWorkflowRates(rerender = true) {
  const cbId = document.getElementById('wfCB')?.value || '';
  const prog = document.getElementById('wfProgram')?.value || '';
  const siteId = document.getElementById('wfSite')?.value || '';
  const qs = new URLSearchParams();
  if (cbId) qs.set('cb_id', cbId);
  if (prog) qs.set('program', prog);
  if (siteId) qs.set('site_id', siteId);
  const resp = await fetch(`/api/workflows/rates?${qs.toString()}`);
  if (resp.ok) {
    wfRates = await resp.json();
    if (rerender) {
      renderWorkflowRatesBanner();
      renderTestCostingTab();
    }
  }
  return wfRates;
}

async function onWorkflowSiteChange() {
  await refreshWorkflowRates(true);
  const siteId = document.getElementById('wfSite')?.value;
  if (siteId) {
    await calculateWorkflowDistances(true);
  } else {
    renderTestCostingTab();
  }
}

async function onWorkflowAuditeeChange() {
  filterWorkflowSitesByAuditee();
  await refreshWorkflowRates(true);
  const siteId = document.getElementById('wfSite')?.value;
  if (siteId) {
    await calculateWorkflowDistances(true);
  } else {
    renderTestCostingTab();
  }
}

async function onWorkflowRatesContextChange() {
  await refreshWorkflowRates(true);
  const siteId = document.getElementById('wfSite')?.value;
  if (siteId) {
    await calculateWorkflowDistances(true);
  }
}

function bindWorkflowForm() {
  const w = wfCurrentData || {};
  document.getElementById('wfModalTitle').textContent = wfCurrentId ? `Audit Workflow #${wfCurrentId}` : 'New Audit & Quote Workflow';
  document.getElementById('wfMetaInfo').textContent = wfCurrentId
    ? `Created: ${_wfDateVal(w.Created_Date) || '-'} by ${w.Created_By || '-'}`
    : 'Unsaved new workflow';

  document.getElementById('wfStatus').value = w.Status || 'Pending';
  document.getElementById('wfProjectNr').value = w.Project_Nr || '';
  document.getElementById('wfAuditConfirmed').checked = Boolean(w.Audit_Confirmed);
  document.getElementById('wfCB').value = w.Certification_Body || '';
  document.getElementById('wfAuditee').value = w.AuditeeID || '';
  filterWorkflowSitesByAuditee(w.SiteID || '');

  document.getElementById('wfProgram').value = w.Audit_Program || '';
  document.getElementById('wfAuditType').value = w.Audit_Type || '';
  document.getElementById('wfAnnouncement').value = w.Announcement || 'Announced';
  document.getElementById('wfDeadline').value = _wfDateVal(w.Audit_Deadline);
  document.getElementById('wfStartDate').value = _wfDateVal(w.Audit_Start_Date);
  document.getElementById('wfEndDate').value = _wfDateVal(w.Audit_End_Date);
  document.getElementById('wfWindowFrom').value = _wfDateVal(w.AuditWindow_From);
  document.getElementById('wfWindowTo').value = _wfDateVal(w.AuditWindow_To);
  const auditDaysEl = document.getElementById('wfAuditDays');
  if (auditDaysEl) {
    auditDaysEl.value = (w.Audit_Days !== null && w.Audit_Days !== undefined && w.Audit_Days !== '')
      ? Number(w.Audit_Days).toFixed(2)
      : '';
  }

  document.getElementById('wfSingleMultiProg').value = w.Single_Multi_Prog || 'Single';
  document.getElementById('wfSingleMultiSite').value = w.Single_Multi_Site || 'Single';
  document.getElementById('wfNrSites').value = w.Nr_Sites ?? 1;
  document.getElementById('wfNrWorkers').value = w.Cost_NrEmployees ?? '';
  document.getElementById('wfMandaysReq').value = w.Mandays_Required ?? '';
  document.getElementById('wfTotalMandays').value = w.Total_Mandays ?? '';
  document.getElementById('wfAuditor1').value = w.Auditor1 || '';
  document.getElementById('wfAuditor2').value = w.Auditor2 || '';
  document.getElementById('wfAuditor3').value = w.Auditor3 || '';
  document.getElementById('wfWitnessAuditor').value = w.Witness_Auditor || '';

  document.getElementById('wfFollowUpAudit').value = w.FollowUp_AuditRequired || '';
  document.getElementById('wfFollowUpDesktop').value = w.FollowUp_DesktopRequired || '';
  document.getElementById('wfPONr').value = w.Purchase_Ord_Nr || '';
  document.getElementById('wfInvoiced').checked = Boolean(w.Invoiced);
  document.getElementById('wfInvNr').value = w.Inv_Number || '';
  document.getElementById('wfInvAmt').value = w.Inv_Amount ?? '';
  document.getElementById('wfLinkSharepoint').value = w.Link_Sharepoint || '';
  document.getElementById('wfLinkCertIQ').value = w.Link_CertIQ || '';
  document.getElementById('wfLinkCertificate').value = w.Link_Certificate || '';
  document.getElementById('wfLinkFSSC').value = w.Link_FSSCPortal || '';
  document.getElementById('wfEmailDetails').value = w.Email_QuoteRequest_Details || '';
  document.getElementById('wfQuoteAdditComments').value = w.Quote_Addit_Comments || '';
  document.getElementById('wfNoAutoUpdateQuote').checked = Boolean(w.Quote_NoAutoUpdate);
  const hideAudEl = document.getElementById('wfHideAuditorNameQuote');
  if (hideAudEl) hideAudEl.checked = Boolean(w.Hide_AuditorName_Quote);

  const btnPreview = document.getElementById('btnPreviewQuote');
  if (btnPreview) btnPreview.style.display = wfCurrentId ? 'inline-flex' : 'none';
}

function renderWorkflowRatesBanner() {
  const el = document.getElementById('wfRatesBanner');
  if (!el || !wfRates) return;
  const s = wfRates.sources || {};
  el.innerHTML = `
    <div class="wf-rate-chip" title="${_wfEsc(s.manday)}"><span>Manday Rate</span><strong>${_wfEur(wfRates.manday_rate)}</strong></div>
    <div class="wf-rate-chip" title="Manday / 8"><span>Hourly Rate</span><strong>${_wfEur(wfRates.manday_hour_rate)}</strong></div>
    <div class="wf-rate-chip" title="${_wfEsc(s.report)}"><span>Report Fee</span><strong>${_wfEur(wfRates.report_fee)}</strong></div>
    <div class="wf-rate-chip" title="${_wfEsc(s.per_km)}"><span>Per KM</span><strong>${_wfEur(wfRates.per_km_rate)}</strong></div>
    <div class="wf-rate-chip" title="${_wfEsc(s.hotel)}"><span>Hotel / Night</span><strong>${_wfEur(wfRates.hotel_rate)}</strong></div>
    <div class="wf-rate-chip" title="${_wfEsc(s.dinner)}"><span>Dinner</span><strong>${_wfEur(wfRates.dinner_rate)}</strong></div>
    <div class="wf-rate-chip"><span>Lunch</span><strong>${_wfEur(wfRates.lunch_rate)}</strong></div>
  `;
}

async function calculateWorkflowDistances(silent = false) {
  const siteId = document.getElementById('wfSite')?.value;
  if (!siteId) {
    if (!silent) alert('Please select an Auditee and Site to be Audited first.');
    return;
  }
  const cbId = document.getElementById('wfCB')?.value || null;
  const program = document.getElementById('wfProgram')?.value || null;
  const btn = document.getElementById('btnCalcDistances');
  if (btn) { btn.disabled = true; btn.textContent = 'Calculating via Google Maps...'; }

  try {
    const resp = await fetch('/api/workflows/calculate-distances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wfid: wfCurrentId,
        cb_id: cbId ? Number(cbId) : null,
        program: program || null,
        site_id: Number(siteId)
      })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || 'Distance calculation failed');
    wfDistances = data.distances || [];
    renderWorkflowDistancesTable();
    autoCalculateWorkflowCosts(true);
    renderTestCostingTab();
  } catch (err) {
    if (!silent) alert('Distance Calculation Error: ' + err.message);
    else console.warn('Auto distance calculation skipped:', err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Update Onboarding & Calculate Distances'; }
  }
}

function renderWorkflowDistancesTable() {
  const tbody = document.getElementById('wfDistancesTableBody');
  if (!tbody) return;
  if (!wfDistances.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#64748b;padding:1.25rem;">Click "Update Onboarding &amp; Calculate Distances" to fetch Google Maps driving distances and onboarding status.</td></tr>';
    return;
  }

  tbody.innerHTML = wfDistances.map((d, idx) => {
    const canSel = Boolean(d.CanSelect) || (d.InternalOnboarded === 'YES' && d.CB_Prog_Onboarded === 'YES');
    const intBadge = d.InternalOnboarded === 'YES'
      ? '<span class="status-badge complete">YES</span>'
      : '<span class="status-badge inactive">NO</span>';
    const cbBadge = d.CB_Prog_Onboarded === 'YES'
      ? '<span class="status-badge complete">YES</span>'
      : '<span class="status-badge inactive">NO</span>';
    const distTxt = (d.Distance !== null && d.Distance !== undefined) ? `${d.Distance} km` : '-';

    return `
      <tr class="${canSel ? '' : 'wf-row-muted'}">
        <td><strong>${_wfEsc(d.Auditor)}</strong></td>
        <td>${_wfEsc(d.City || '-')}</td>
        <td>${_wfEsc(d.Country || '-')}</td>
        <td style="text-align:center;">${intBadge}</td>
        <td style="text-align:center;">${cbBadge}</td>
        <td style="text-align:right;font-weight:600;">${distTxt}</td>
        <td>
          <select class="wf-input-sm" ${canSel ? '' : 'disabled title="Auditor must be onboarded internally and with CB & Program"'}
                  onchange="onSelectDistanceAuditor(${idx}, this.value)">
            <option value="">--</option>
            <option value="Auditor1" ${d.SelectAud === 'Auditor1' ? 'selected' : ''}>Auditor 1</option>
            <option value="Auditor2" ${d.SelectAud === 'Auditor2' ? 'selected' : ''}>Auditor 2</option>
            <option value="Auditor3" ${d.SelectAud === 'Auditor3' ? 'selected' : ''}>Auditor 3</option>
          </select>
        </td>
        <td style="text-align:center;">
          <input type="checkbox" ${d.WillDrive ? 'checked' : ''} ${canSel ? '' : 'disabled'}
                 onchange="onToggleDistanceWillDrive(${idx}, this.checked)">
        </td>
      </tr>
    `;
  }).join('');
}

function onToggleDistanceWillDrive(idx, checked) {
  if (!wfDistances[idx]) return;
  wfDistances[idx].WillDrive = checked;
  autoCalculateWorkflowCosts(true);
  renderTestCostingTab();
}

function onSelectDistanceAuditor(idx, role) {
  const prevRole = wfDistances[idx]?.SelectAud;
  if (role) {
    wfDistances.forEach((d, i) => { if (i !== idx && d.SelectAud === role) d.SelectAud = ''; });
  }
  wfDistances[idx].SelectAud = role;
  const audId = wfDistances[idx].AuditorID;
  if (prevRole && prevRole !== role) {
    const prevEl = document.getElementById('wf' + prevRole);
    if (prevEl && String(prevEl.value) === String(audId)) prevEl.value = '';
  }
  if (role === 'Auditor1') document.getElementById('wfAuditor1').value = audId;
  if (role === 'Auditor2') document.getElementById('wfAuditor2').value = audId;
  if (role === 'Auditor3') document.getElementById('wfAuditor3').value = audId;
  renderWorkflowDistancesTable();
  autoCalculateWorkflowCosts(true);
  renderTestCostingTab();
}

function onAuditorDropdownChange() {
  const a1 = document.getElementById('wfAuditor1')?.value || '';
  const a2 = document.getElementById('wfAuditor2')?.value || '';
  const a3 = document.getElementById('wfAuditor3')?.value || '';
  if (wfDistances.length) {
    wfDistances.forEach(d => {
      const idStr = String(d.AuditorID);
      if (idStr === String(a1)) d.SelectAud = 'Auditor1';
      else if (idStr === String(a2)) d.SelectAud = 'Auditor2';
      else if (idStr === String(a3)) d.SelectAud = 'Auditor3';
      else if (d.SelectAud === 'Auditor1' || d.SelectAud === 'Auditor2' || d.SelectAud === 'Auditor3') d.SelectAud = '';
    });
    renderWorkflowDistancesTable();
  }
  autoCalculateWorkflowCosts(true);
  renderTestCostingTab();
}

function onAuditDaysChange() {
  const el = document.getElementById('wfAuditDays');
  if (!el) return;
  const raw = el.value;
  if (raw !== '' && raw !== null && !Number.isNaN(parseFloat(raw))) {
    el.value = round2(parseFloat(raw)).toFixed(2);
  }
  _applyAuditDaysToSelectedAuditors(true);
  recalcWorkflowCostings(true);
  renderTestCostingTab();
}

function _applyAuditDaysToSelectedAuditors(overwriteExisting = true) {
  const auditDays = _wfNum(document.getElementById('wfAuditDays')?.value);
  if (!(auditDays > 0)) return;
  const slots = [
    { col: 'Aud1', elId: 'wfAuditor1' },
    { col: 'Aud2', elId: 'wfAuditor2' },
    { col: 'Aud3', elId: 'wfAuditor3' }
  ];
  slots.forEach(({ col, elId }) => {
    const audId = document.getElementById(elId)?.value;
    const row = _findCostRow(10);
    if (!row) return;
    if (!audId) {
      if (overwriteExisting) row[col] = null;
      return;
    }
    if (overwriteExisting || row[col] === null || row[col] === undefined || row[col] === '') {
      row[col] = round2(auditDays);
    }
  });
}

function _getAuditDaysCount() {
  const auditDays = _wfNum(document.getElementById('wfAuditDays')?.value);
  if (auditDays > 0) return auditDays;
  const s = document.getElementById('wfStartDate')?.value;
  const e = document.getElementById('wfEndDate')?.value;
  if (s && e) {
    const diff = Math.round((new Date(e) - new Date(s)) / 86400000) + 1;
    if (diff > 0) return diff;
  }
  const req = _wfNum(document.getElementById('wfMandaysReq')?.value);
  return req > 0 ? req : 1;
}

function _findCostRow(ordBy) {
  return wfCostings.find(c => Number(c.OrdBy) === Number(ordBy));
}

function autoCalculateWorkflowCosts(silent = false) {
  if (!wfRates) return;
  const auditDaysEl = document.getElementById('wfAuditDays');
  const auditDays = _wfNum(auditDaysEl?.value);
  if (!(auditDays > 0) && !silent) {
    alert('Audit Days is required before any calculations can be done.');
    if (auditDaysEl) auditDaysEl.focus();
    return;
  }

  const days = auditDays > 0 ? auditDays : 0;
  const aud1Id = document.getElementById('wfAuditor1')?.value;
  const aud2Id = document.getElementById('wfAuditor2')?.value;
  const aud3Id = document.getElementById('wfAuditor3')?.value;

  const setVal = (ord, col, val) => {
    const r = _findCostRow(ord);
    if (r) r[col] = val;
  };

  // Audit fee & report writing (only when Audit Days is set)
  if (days > 0) {
    setVal(10, 'Aud1', aud1Id ? round2(days) : null);
    setVal(10, 'Aud2', aud2Id ? round2(days) : null);
    setVal(10, 'Aud3', aud3Id ? round2(days) : null);
    setVal(30, 'Aud1', aud1Id ? 1 : null);
  } else {
    if (!aud1Id) { setVal(10, 'Aud1', null); setVal(30, 'Aud1', null); }
    if (!aud2Id) setVal(10, 'Aud2', null);
    if (!aud3Id) setVal(10, 'Aud3', null);
  }

  // Per-auditor driving, hotel, dinner, lunches based on distance & WillDrive
  const audCols = [
    { col: 'Aud1', id: aud1Id, role: 'Auditor1' },
    { col: 'Aud2', id: aud2Id, role: 'Auditor2' },
    { col: 'Aud3', id: aud3Id, role: 'Auditor3' }
  ];

  audCols.forEach(({ col, id, role }) => {
    if (!id) {
      [60, 70, 80, 100, 150, 160, 180, 190, 210, 220].forEach(o => setVal(o, col, null));
      return;
    }
    const distRow = wfDistances.find(d => String(d.AuditorID) === String(id) || d.SelectAud === role);
    const oneWayKm = distRow && distRow.Distance !== null ? _wfNum(distRow.Distance) : 0;
    const willDrive = distRow ? Boolean(distRow.WillDrive) : (oneWayKm > 0);
    const returnKm = willDrive ? oneWayKm * 2 : 0;

    setVal(60, col, returnKm || null);
    setVal(70, col, willDrive && returnKm > 0 ? 1 : null);
    setVal(80, col, wfRates.per_km_rate);
    setVal(100, col, wfRates.avg_speed);

    if (days > 0) {
      const needsHotel = oneWayKm >= _wfNum(wfRates.hotel_km_threshold || 100);
      const nights = Math.max(days > 1 ? (Math.ceil(days) - 1) : 0, needsHotel ? 1 : 0);
      setVal(150, col, wfRates.hotel_rate);
      setVal(160, col, nights || null);
      setVal(180, col, wfRates.dinner_rate);
      setVal(190, col, nights || null);
      setVal(210, col, wfRates.lunch_rate);
      setVal(220, col, days || null);
    }
  });

  recalcWorkflowCostings(true);
}

function recalcWorkflowCostings(rerender = true) {
  if (!wfRates) return;
  const g = (ord, col) => _wfNum(_findCostRow(ord)?.[col]);
  const s = (ord, col, val) => { const r = _findCostRow(ord); if (r) r[col] = val; };

  ['Aud1', 'Aud2', 'Aud3'].forEach(col => {
    const mandays = g(10, col);
    s(20, col, round2(mandays * wfRates.manday_rate));

    const reports = g(30, col);
    s(40, col, round2(reports * wfRates.report_fee));
    s(45, col, round2(g(20, col) + g(40, col)));

    const prepMandays = g(50, col);
    s(55, col, round2(prepMandays * wfRates.manday_rate));

    const retDist = g(60, col);
    const trips = g(70, col) || (retDist > 0 ? 1 : 0);
    const perKm = g(80, col) || wfRates.per_km_rate;
    s(90, col, round2(retDist * trips * perKm));

    const speed = g(100, col) || wfRates.avg_speed || 64;
    const estHrs = retDist > 0 ? round2((retDist * trips) / speed) : 0;
    s(110, col, estHrs);
    const less2 = estHrs > 0 ? round2(Math.max(0, estHrs - 2)) : 0;
    s(120, col, less2);
    const overrideHrs = g(130, col);
    const billableHrs = overrideHrs > 0 ? overrideHrs : less2;
    s(140, col, round2(billableHrs * wfRates.manday_hour_rate));

    const hotelRate = g(150, col) || wfRates.hotel_rate;
    s(170, col, round2(hotelRate * g(160, col)));

    const dinnerRate = g(180, col) || wfRates.dinner_rate;
    s(200, col, round2(dinnerRate * g(190, col)));

    const lunchRate = g(210, col) || wfRates.lunch_rate;
    s(230, col, round2(lunchRate * g(220, col)));
  });

  // Compute totals per column (only TotalCalc rows)
  let t1 = 0, t2 = 0, t3 = 0, tOther = 0;
  wfCostings.forEach(c => {
    if (c.TotalCalc) {
      t1 += _wfNum(c.Aud1);
      t2 += _wfNum(c.Aud2);
      t3 += _wfNum(c.Aud3);
      tOther += _wfNum(c.OtherCharge_Amount);
    }
  });
  const grand = round2(t1 + t2 + t3 + tOther);

  const summary = document.getElementById('wfCostTotalsBar');
  if (summary) {
    summary.innerHTML = `
      <div><span>Auditor 1:</span> <strong>${_wfEur(t1)}</strong></div>
      <div><span>Auditor 2:</span> <strong>${_wfEur(t2)}</strong></div>
      <div><span>Auditor 3:</span> <strong>${_wfEur(t3)}</strong></div>
      <div><span>Other:</span> <strong>${_wfEur(tOther)}</strong></div>
      <div class="wf-grand-total"><span>Total Costs:</span> <strong>${_wfEur(grand)}</strong></div>
    `;
  }

  if (rerender) renderWorkflowCostingsTable();
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function _fmtMinutes(mins) {
  if (mins === null || mins === undefined || Number.isNaN(Number(mins))) return '';
  const m = Math.round(Number(mins));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h > 0 ? `${h}h ${r}m` : `${r}m`;
}

function _computeProjectedAuditorCost(distRow, days, rates, asLead, flightThresholdKm) {
  const hasDist = distRow.Distance !== null && distRow.Distance !== undefined;
  const oneWayKm = hasDist ? _wfNum(distRow.Distance) : 0;
  const flightLikely = !hasDist || oneWayKm > flightThresholdKm;
  // Default WillDrive from existing row if set, otherwise true when <= flight threshold
  const willDrive = (distRow.WillDrive !== undefined && distRow.WillDrive !== null)
    ? Boolean(distRow.WillDrive)
    : (!flightLikely && oneWayKm > 0);

  const auditFee = round2(days * rates.manday_rate);
  const reportFee = asLead ? round2(rates.report_fee) : 0;
  const baseFee = round2(auditFee + reportFee);

  const avgSpeed = rates.avg_speed || 64;
  const oneWayDriveMins = hasDist && oneWayKm > 0 ? Math.round((oneWayKm / avgSpeed) * 60) : null;
  const returnKm = willDrive ? oneWayKm * 2 : 0;
  const roadTravel = round2(returnKm * rates.per_km_rate);

  const estHrs = returnKm > 0 ? round2(returnKm / avgSpeed) : 0;
  const billableHrs = estHrs > 0 ? round2(Math.max(0, estHrs - 2)) : 0;
  const travelTime = round2(billableHrs * rates.manday_hour_rate);

  const hotelThreshold = _wfNum(rates.hotel_km_threshold || 100);
  const needsHotel = !hasDist || oneWayKm >= hotelThreshold;
  const nights = Math.max(days > 1 ? (Math.ceil(days) - 1) : 0, needsHotel ? 1 : 0);
  const hotelCost = round2(nights * rates.hotel_rate);
  const dinnerCost = round2(nights * rates.dinner_rate);
  const lunchCost = round2(days * rates.lunch_rate);
  const hotelMeals = round2(hotelCost + dinnerCost + lunchCost);

  const estFlight = round2(_wfNum(wfTestFlightCosts[distRow.AuditorID]));
  const total = round2(baseFee + roadTravel + travelTime + hotelMeals + estFlight);
  return {
    oneWayKm,
    hasDist,
    flightLikely,
    willDrive,
    needsHotel,
    nights,
    oneWayDriveMins,
    estHrs,
    billableHrs,
    baseFee,
    auditFee,
    reportFee,
    roadTravel,
    travelTime,
    hotelMeals,
    estFlight,
    total
  };
}

function sortTestCostingBy(col) {
  if (wfTestSort.col === col) {
    wfTestSort.dir = (wfTestSort.dir === 'asc') ? 'desc' : 'asc';
  } else {
    wfTestSort.col = col;
    wfTestSort.dir = 'asc';
  }
  renderTestCostingTab();
}

function _seedTestFlightCostsFromCostings() {
  const flightRow = _findCostRow(240);
  if (!flightRow) return;
  [
    { elId: 'wfAuditor1', col: 'Aud1' },
    { elId: 'wfAuditor2', col: 'Aud2' },
    { elId: 'wfAuditor3', col: 'Aud3' }
  ].forEach(({ elId, col }) => {
    const aid = document.getElementById(elId)?.value;
    if (aid && wfTestFlightCosts[aid] === undefined && _wfNum(flightRow[col]) > 0) {
      wfTestFlightCosts[aid] = round2(_wfNum(flightRow[col]));
    }
  });
}

function _getTestCostComputedList() {
  const days = _wfNum(document.getElementById('wfAuditDays')?.value);
  const onlyOnboarded = document.getElementById('wfTestOnlyOnboarded')?.checked ?? true;
  const flightThresholdKm = _wfNum(document.getElementById('wfTestFlightKm')?.value) || 400;
  const rows = wfDistances
    .map(d => {
      const canSel = Boolean(d.CanSelect) || (d.InternalOnboarded === 'YES' && d.CB_Prog_Onboarded === 'YES');
      return { d, canSel };
    })
    .filter(x => !onlyOnboarded || x.canSel);

  return rows.map(({ d, canSel }) => {
    const isCoAud = d.SelectAud === 'Auditor2' || d.SelectAud === 'Auditor3';
    const calc = _computeProjectedAuditorCost(d, days, wfRates, !isCoAud, flightThresholdKm);
    return { d, canSel, calc };
  });
}

function _updateTestCostSummary(computed, minTotal) {
  const summary = document.getElementById('wfTestCostSelectionSummary');
  if (!summary || !computed.length) return;
  const cheapestItem = computed.reduce((best, cur) => (cur.calc.total < best.calc.total ? cur : best), computed[0]);
  const selectedRows = computed.filter(x => x.d.SelectAud === 'Auditor1' || x.d.SelectAud === 'Auditor2' || x.d.SelectAud === 'Auditor3');
  const teamTotal = round2(selectedRows.reduce((acc, x) => acc + x.calc.total, 0));
  if (selectedRows.length) {
    const chips = selectedRows
      .sort((a, b) => a.d.SelectAud.localeCompare(b.d.SelectAud))
      .map(x => `<div><span>${_wfEsc(x.d.SelectAud)} (${_wfEsc(x.d.Auditor)}):</span> <strong>${_wfEur(x.calc.total)}</strong></div>`)
      .join('');
    summary.innerHTML = `${chips}<div class="wf-grand-total"><span>Selected Team Total:</span> <strong>${_wfEur(teamTotal)}</strong></div>`;
  } else {
    summary.innerHTML = `<div><span>Lowest Single-Auditor Cost:</span> <strong>${_wfEsc(cheapestItem.d.Auditor)} (${_wfEur(minTotal)})</strong></div><div style="color:#64748b;font-size:0.82rem;">Select Auditor 1 / 2 / 3 below, then click Apply.</div>`;
  }
}

function renderTestCostingTab() {
  const banner = document.getElementById('wfTestCostBanner');
  const summary = document.getElementById('wfTestCostSelectionSummary');
  const tbody = document.getElementById('wfTestCostingTableBody');
  if (!tbody) return;

  _seedTestFlightCostsFromCostings();

  const days = _wfNum(document.getElementById('wfAuditDays')?.value);
  if (banner && wfRates) {
    banner.innerHTML = `
      <div class="wf-rate-chip"><span>Audit Days</span><strong>${days > 0 ? days.toFixed(2) : 'Not set'}</strong></div>
      <div class="wf-rate-chip"><span>Manday Rate</span><strong>${_wfEur(wfRates.manday_rate)}</strong></div>
      <div class="wf-rate-chip"><span>Report Fee (Lead)</span><strong>${_wfEur(wfRates.report_fee)}</strong></div>
      <div class="wf-rate-chip"><span>Per KM</span><strong>${_wfEur(wfRates.per_km_rate)}</strong></div>
      <div class="wf-rate-chip"><span>Speed Rule</span><strong>${wfRates.avg_speed || 64} km/h (-2h)</strong></div>
      <div class="wf-rate-chip"><span>Hotel Rule</span><strong>&ge; ${wfRates.hotel_km_threshold || 100} km (${_wfEur(wfRates.hotel_rate)} + ${_wfEur(wfRates.dinner_rate)})</strong></div>
    `;
  }

  document.querySelectorAll('#wfTestCostingTable .wf-sort-ind').forEach(el => {
    const k = el.getAttribute('data-sort');
    if (k === wfTestSort.col || (k === 'vsCheapest' && wfTestSort.col === 'total')) {
      el.textContent = wfTestSort.dir === 'asc' ? '▲' : '▼';
    } else {
      el.textContent = '';
    }
  });

  if (!wfRates) {
    tbody.innerHTML = '<tr><td colspan="13" style="text-align:center;color:#64748b;padding:1.25rem;">Loading rates...</td></tr>';
    return;
  }
  if (!(days > 0)) {
    if (summary) summary.innerHTML = '<span style="color:#dc2626;font-weight:600;">Enter Audit Days above to simulate costs across all auditors.</span>';
    tbody.innerHTML = '<tr><td colspan="13" style="text-align:center;color:#dc2626;padding:1.25rem;">Please enter <strong>Audit Days</strong> in the header to calculate projected costs.</td></tr>';
    return;
  }
  if (!wfDistances.length) {
    if (summary) summary.innerHTML = '<span style="color:#64748b;">Select a Site to automatically calculate distances, or click Refresh Distances.</span>';
    tbody.innerHTML = '<tr><td colspan="13" style="text-align:center;color:#64748b;padding:1.25rem;">No auditor distances loaded yet. Select a <strong>Site to be Audited</strong> to calculate distances automatically.</td></tr>';
    return;
  }

  const computed = _getTestCostComputedList();
  if (!computed.length) {
    if (summary) summary.innerHTML = '<span style="color:#b45309;">No fully onboarded auditors found for this CB &amp; Program. Uncheck "Only onboarded auditors" to inspect all active auditors.</span>';
    tbody.innerHTML = '<tr><td colspan="13" style="text-align:center;color:#64748b;padding:1.25rem;">No matching auditors. Try unchecking "Only onboarded auditors".</td></tr>';
    return;
  }

  const minTotal = Math.min(...computed.map(x => x.calc.total));

  const dirMul = wfTestSort.dir === 'asc' ? 1 : -1;
  computed.sort((a, b) => {
    const col = wfTestSort.col;
    if (col === 'auditor') return a.d.Auditor.localeCompare(b.d.Auditor) * dirMul;
    if (col === 'distance') {
      const da = a.calc.hasDist ? a.calc.oneWayKm : 999999;
      const db = b.calc.hasDist ? b.calc.oneWayKm : 999999;
      return (da - db) * dirMul;
    }
    if (col === 'duration') {
      const ta = a.calc.oneWayDriveMins !== null ? a.calc.oneWayDriveMins : 999999;
      const tb = b.calc.oneWayDriveMins !== null ? b.calc.oneWayDriveMins : 999999;
      return (ta - tb) * dirMul;
    }
    const va = a.calc[col] ?? a.calc.total;
    const vb = b.calc[col] ?? b.calc.total;
    return (va - vb) * dirMul;
  });

  _updateTestCostSummary(computed, minTotal);

  tbody.innerHTML = computed.map(({ d, canSel, calc }) => {
    const delta = round2(calc.total - minTotal);
    const isCheapest = delta === 0;
    const isSelected = Boolean(d.SelectAud);
    const driveDur = _fmtMinutes(calc.oneWayDriveMins);
    const distCell = calc.hasDist ? `${calc.oneWayKm} km` : '<span style="color:#dc2626;">No route</span>';
    const retHrs = calc.hasDist && calc.oneWayKm > 0 ? round2((calc.oneWayKm * 2) / (wfRates.avg_speed || 64)) : 0;
    const durCell = driveDur
      ? `<span title="1-way @ ${wfRates.avg_speed || 64} km/h (Return: ${retHrs} hrs)">${driveDur}</span>`
      : '<span style="color:#94a3b8;">-</span>';

    const leftBadges = [];
    if (!canSel) leftBadges.push('<span class="status-badge inactive" style="font-size:0.68rem;">Not Onboarded</span>');
    if (calc.nights > 0) leftBadges.push(`<span class="status-badge" style="font-size:0.68rem;background:#e0f2fe;color:#075985;">Hotel (${calc.nights}n)</span>`);

    const flightFlagHtml = calc.flightLikely
      ? '<span class="status-badge" style="font-size:0.7rem;background:#fee2e2;color:#b91c1c;border:1px solid #fecaca;">Flight Likely</span>'
      : '<span style="color:#cbd5e1;">-</span>';

    const flightVal = wfTestFlightCosts[d.AuditorID] !== undefined ? wfTestFlightCosts[d.AuditorID] : '';

    const deltaHtml = isCheapest
      ? '<span class="status-badge complete" style="font-size:0.72rem;">Cheapest</span>'
      : `<span style="color:#b45309;font-weight:600;">+${_wfEur(delta)}</span>`;

    return `
      <tr data-aud-id="${d.AuditorID}" class="${isSelected ? 'wf-row-selected' : (canSel ? '' : 'wf-row-muted')}" style="${isSelected ? 'background:#f0fdf4;' : ''}">
        <td>
          <strong>${_wfEsc(d.Auditor)}</strong>
          <div style="font-size:0.75rem;color:#64748b;">${_wfEsc([d.City, d.Country].filter(Boolean).join(', ') || '-')}</div>
          ${leftBadges.length ? `<div style="display:flex;gap:0.25rem;flex-wrap:wrap;margin-top:2px;">${leftBadges.join('')}</div>` : ''}
        </td>
        <td style="text-align:right;font-weight:600;white-space:nowrap;">${distCell}</td>
        <td style="text-align:right;color:#334155;white-space:nowrap;">${durCell}</td>
        <td style="text-align:center;">
          <input type="checkbox" ${calc.willDrive ? 'checked' : ''} onchange="onToggleTestCostWillDrive(${d.AuditorID}, this.checked)">
        </td>
        <td>
          <select class="wf-input-sm" onchange="onSelectTestCostRole(${d.AuditorID}, this.value)">
            <option value="">--</option>
            <option value="Auditor1" ${d.SelectAud === 'Auditor1' ? 'selected' : ''}>Auditor 1 (Lead)</option>
            <option value="Auditor2" ${d.SelectAud === 'Auditor2' ? 'selected' : ''}>Auditor 2</option>
            <option value="Auditor3" ${d.SelectAud === 'Auditor3' ? 'selected' : ''}>Auditor 3</option>
          </select>
        </td>
        <td style="text-align:center;white-space:nowrap;">${flightFlagHtml}</td>
        <td style="text-align:right;">${_wfEur(calc.baseFee)}</td>
        <td style="text-align:right;">${_wfEur(calc.roadTravel)}</td>
        <td style="text-align:right;" title="${calc.billableHrs} billable hrs">${_wfEur(calc.travelTime)}</td>
        <td style="text-align:right;">${_wfEur(calc.hotelMeals)}</td>
        <td style="text-align:right;">
          <input type="number" step="0.01" min="0" placeholder="0.00"
                 class="wf-no-spin"
                 value="${flightVal !== '' ? flightVal : ''}"
                 style="width:76px;text-align:right;padding:0.2rem 0.35rem;border:1px solid #cbd5e1;border-radius:4px;font-size:0.8rem;"
                 oninput="onInputTestFlightCost(${d.AuditorID}, this.value)"
                 onchange="renderTestCostingTab()">
        </td>
        <td class="wf-test-total-cell" style="text-align:right;font-weight:700;color:#001429;">${_wfEur(calc.total)}</td>
        <td class="wf-test-delta-cell" style="text-align:right;">${deltaHtml}</td>
      </tr>
    `;
  }).join('');
}

function onInputTestFlightCost(auditorId, rawVal) {
  if (rawVal === '' || rawVal === null) {
    delete wfTestFlightCosts[auditorId];
  } else {
    const parsed = parseFloat(rawVal);
    wfTestFlightCosts[auditorId] = Number.isNaN(parsed) ? 0 : Math.max(0, round2(parsed));
  }
  const computed = _getTestCostComputedList();
  if (!computed.length) return;
  const minTotal = Math.min(...computed.map(x => x.calc.total));
  _updateTestCostSummary(computed, minTotal);
  computed.forEach(({ d, calc }) => {
    const tr = document.querySelector(`#wfTestCostingTableBody tr[data-aud-id="${d.AuditorID}"]`);
    if (!tr) return;
    const totalCell = tr.querySelector('.wf-test-total-cell');
    const deltaCell = tr.querySelector('.wf-test-delta-cell');
    if (totalCell) totalCell.textContent = _wfEur(calc.total);
    if (deltaCell) {
      const delta = round2(calc.total - minTotal);
      deltaCell.innerHTML = (delta === 0)
        ? '<span class="status-badge complete" style="font-size:0.72rem;">Cheapest</span>'
        : `<span style="color:#b45309;font-weight:600;">+${_wfEur(delta)}</span>`;
    }
  });
}

function onToggleTestCostWillDrive(auditorId, checked) {
  const row = wfDistances.find(d => Number(d.AuditorID) === Number(auditorId));
  if (!row) return;
  row.WillDrive = checked;
  renderWorkflowDistancesTable();
  renderTestCostingTab();
}

function onSelectTestCostRole(auditorId, role) {
  const idx = wfDistances.findIndex(d => Number(d.AuditorID) === Number(auditorId));
  if (idx === -1) return;
  const prevRole = wfDistances[idx].SelectAud;
  if (role) {
    wfDistances.forEach((d, i) => { if (i !== idx && d.SelectAud === role) d.SelectAud = ''; });
  }
  wfDistances[idx].SelectAud = role;
  if (prevRole && prevRole !== role) {
    const prevEl = document.getElementById('wf' + prevRole);
    if (prevEl && String(prevEl.value) === String(auditorId)) prevEl.value = '';
  }
  if (role === 'Auditor1') document.getElementById('wfAuditor1').value = auditorId;
  if (role === 'Auditor2') document.getElementById('wfAuditor2').value = auditorId;
  if (role === 'Auditor3') document.getElementById('wfAuditor3').value = auditorId;
  renderWorkflowDistancesTable();
  renderTestCostingTab();
}

function applyTestCostingSelection(andGenerateQuote = false) {
  const a1 = document.getElementById('wfAuditor1')?.value;
  const a2 = document.getElementById('wfAuditor2')?.value;
  const a3 = document.getElementById('wfAuditor3')?.value;
  if (!a1 && !a2 && !a3) {
    alert('Please select at least one Auditor (e.g. Auditor 1) in the comparison table first.');
    return;
  }
  autoCalculateWorkflowCosts(false);

  // Apply any captured Estimated Flight Costs to OrdBy 240 (Flights - Total Charge)
  const flightRow = _findCostRow(240);
  if (flightRow) {
    [
      { aid: a1, col: 'Aud1' },
      { aid: a2, col: 'Aud2' },
      { aid: a3, col: 'Aud3' }
    ].forEach(({ aid, col }) => {
      if (aid && wfTestFlightCosts[aid] !== undefined) {
        flightRow[col] = wfTestFlightCosts[aid] > 0 ? round2(wfTestFlightCosts[aid]) : null;
      }
    });
    recalcWorkflowCostings(true);
  }

  if (andGenerateQuote) {
    pullQuoteFromCostings();
    switchWorkflowTab('wfTabQuote');
  } else {
    switchWorkflowTab('wfTabCostings');
  }
}

let wfCostRibbonOpen = { Aud1: true, Aud2: false, Aud3: false, Other: true };

function toggleAuditorCostRibbon(key) {
  wfCostRibbonOpen[key] = !wfCostRibbonOpen[key];
  renderWorkflowCostingsTable();
}

function _getSelectedAuditorsForCosting() {
  const slots = [
    { col: 'Aud1', label: 'Auditor 1', elId: 'wfAuditor1' },
    { col: 'Aud2', label: 'Auditor 2', elId: 'wfAuditor2' },
    { col: 'Aud3', label: 'Auditor 3', elId: 'wfAuditor3' }
  ];
  return slots
    .map(s => {
      const sel = document.getElementById(s.elId);
      const id = sel ? sel.value : '';
      const name = (sel && sel.selectedIndex > 0) ? sel.options[sel.selectedIndex].text : '';
      return { ...s, id, name };
    })
    .filter(s => Boolean(s.id));
}

const WF_DECIMAL2_ORDS = new Set([10, 30, 50, 80, 130, 150, 180, 210, 240, 250, 260, 270, 280, 290]);

function _setCostField(ordBy, col, val) {
  let row = _findCostRow(ordBy);
  if (row) {
    if (val === '' || val === null || val === undefined) {
      row[col] = null;
    } else {
      const parsed = parseFloat(val);
      row[col] = Number.isNaN(parsed) ? null : (WF_DECIMAL2_ORDS.has(Number(ordBy)) ? round2(parsed) : parsed);
    }
    recalcWorkflowCostings(true);
  }
}

function renderWorkflowCostingsTable() {
  const container = document.getElementById('wfCostingsContainer');
  if (!container) return;

  const selected = _getSelectedAuditorsForCosting();
  const customOthers = wfCostings.filter(c => _wfNum(c.OrdBy) > 290);

  if (!selected.length && !customOthers.length) {
    container.innerHTML = '<div style="padding:1.5rem;text-align:center;color:#64748b;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;">Select at least one Auditor in the <strong>Audit Details &amp; Distances</strong> tab to configure auditor costings.</div>';
    return;
  }

  const getRow = (ord) => _findCostRow(ord) || {};
  const valOf = (ord, col) => getRow(ord)[col];
  const inp = (ord, col, placeholder = '') => {
    const v = valOf(ord, col);
    let displayVal = '';
    if (v !== null && v !== undefined && v !== '') {
      displayVal = WF_DECIMAL2_ORDS.has(ord) ? Number(v).toFixed(2) : v;
    }
    const step = WF_DECIMAL2_ORDS.has(ord) ? '0.01' : 'any';
    return `<input type="number" step="${step}" class="wf-cost-input" value="${displayVal}" placeholder="${placeholder}" onchange="_setCostField(${ord}, '${col}', this.value)">`;
  };
  const ro = (ord, col) => `<span class="wf-cost-readonly">${_wfEur(valOf(ord, col))}</span>`;

  let html = selected.map(s => {
    const col = s.col;
    const isOpen = Boolean(wfCostRibbonOpen[col]);
    const audTotal = wfCostings.reduce((sum, c) => sum + (c.TotalCalc ? _wfNum(c[col]) : 0), 0);

    return `
      <div class="wf-auditor-accordion">
        <div class="wf-auditor-ribbon ${isOpen ? 'open' : ''}" onclick="toggleAuditorCostRibbon('${col}')">
          <span>${isOpen ? '▾' : '▸'} ${s.label}: ${_wfEsc(s.name)}</span>
          <span class="wf-ribbon-total">${_wfEur(audTotal)}</span>
        </div>
        ${isOpen ? `
          <div class="wf-auditor-body">
            <div class="wf-cost-cards-grid">
              <div class="wf-cost-card">
                <h5>Audit &amp; Report Fees</h5>
                <div class="wf-cost-kv"><span>Audit Mandays</span>${inp(10, col)}</div>
                <div class="wf-cost-kv is-total"><span>Audit Fee Total</span>${ro(20, col)}</div>
                <div class="wf-cost-kv"><span>Reports to Write</span>${inp(30, col)}</div>
                <div class="wf-cost-kv is-total"><span>Report Writing Total</span>${ro(40, col)}</div>
                <div class="wf-cost-kv"><span>Prep Mandays</span>${inp(50, col)}</div>
                <div class="wf-cost-kv is-total"><span>Prep Total</span>${ro(55, col)}</div>
              </div>

              <div class="wf-cost-card">
                <h5>Driving &amp; Travel Time</h5>
                <div class="wf-cost-kv"><span>Return Distance (km)</span>${inp(60, col)}</div>
                <div class="wf-cost-kv"><span>Return Trips</span>${inp(70, col)}</div>
                <div class="wf-cost-kv"><span>Rate / km (€)</span>${inp(80, col)}</div>
                <div class="wf-cost-kv is-total"><span>Driving KMs Total</span>${ro(90, col)}</div>
                <div class="wf-cost-kv"><span>Avg Speed (km/h)</span>${inp(100, col)}</div>
                <div class="wf-cost-kv"><span>Est. / Less 2h (hrs)</span><span class="wf-cost-readonly">${_wfNum(valOf(110, col))} / ${_wfNum(valOf(120, col))}</span></div>
                <div class="wf-cost-kv"><span>Override Hours</span>${inp(130, col)}</div>
                <div class="wf-cost-kv is-total"><span>Travel Time Total</span>${ro(140, col)}</div>
              </div>

              <div class="wf-cost-card">
                <h5>Accommodation &amp; Meals</h5>
                <div class="wf-cost-kv"><span>Hotel Rate / Night</span>${inp(150, col)}</div>
                <div class="wf-cost-kv"><span>Hotel Nights</span>${inp(160, col)}</div>
                <div class="wf-cost-kv is-total"><span>Hotel Total</span>${ro(170, col)}</div>
                <div class="wf-cost-kv"><span>Dinner Rate</span>${inp(180, col)}</div>
                <div class="wf-cost-kv"><span>Nr of Dinners</span>${inp(190, col)}</div>
                <div class="wf-cost-kv is-total"><span>Dinner Total</span>${ro(200, col)}</div>
                <div class="wf-cost-kv"><span>Lunch Rate</span>${inp(210, col)}</div>
                <div class="wf-cost-kv"><span>Nr of Lunches</span>${inp(220, col)}</div>
                <div class="wf-cost-kv is-total"><span>Lunch Total</span>${ro(230, col)}</div>
              </div>

              <div class="wf-cost-card">
                <h5>Travel &amp; Other Expenses</h5>
                <div class="wf-cost-kv"><span>Flights (€)</span>${inp(240, col)}</div>
                <div class="wf-cost-kv"><span>Intl Travel Time (€)</span>${inp(245, col)}</div>
                <div class="wf-cost-kv"><span>Airport Parking (€)</span>${inp(250, col)}</div>
                <div class="wf-cost-kv"><span>Public Transport (€)</span>${inp(260, col)}</div>
                <div class="wf-cost-kv"><span>Taxis (€)</span>${inp(270, col)}</div>
                <div class="wf-cost-kv"><span>Car Hire (€)</span>${inp(280, col)}</div>
                <div class="wf-cost-kv"><span>Visas (€)</span>${inp(290, col)}</div>
              </div>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  if (customOthers.length) {
    const otherTotal = customOthers.reduce((s, c) => s + _wfNum(c.OtherCharge_Amount), 0);
    const isOpen = Boolean(wfCostRibbonOpen.Other);
    html += `
      <div class="wf-auditor-accordion">
        <div class="wf-auditor-ribbon ${isOpen ? 'open' : ''}" onclick="toggleAuditorCostRibbon('Other')">
          <span>${isOpen ? '▾' : '▸'} Other Charges (${customOthers.length})</span>
          <span class="wf-ribbon-total">${_wfEur(otherTotal)}</span>
        </div>
        ${isOpen ? `
          <div class="wf-auditor-body">
            ${customOthers.map(c => {
              const realIdx = wfCostings.indexOf(c);
              return `
                <div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:0.4rem;">
                  <input type="text" class="wf-input-sm" style="flex:2;" value="${_wfEsc(c.Description)}" onchange="wfCostings[${realIdx}].Description = this.value;">
                  <input type="number" step="0.01" class="wf-cost-input" value="${c.OtherCharge_Amount ?? 0}" onchange="wfCostings[${realIdx}].OtherCharge_Amount = parseFloat(this.value || 0); recalcWorkflowCostings(true);">
                  <input type="text" class="wf-input-sm" style="flex:2;" placeholder="Comments" value="${_wfEsc(c.Comments || '')}" onchange="wfCostings[${realIdx}].Comments = this.value;">
                  <button type="button" class="wf-btn-del" onclick="wfCostings.splice(${realIdx}, 1); recalcWorkflowCostings(true);">&times;</button>
                </div>
              `;
            }).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  container.innerHTML = html;
}

function addOtherCostRow() {
  const desc = prompt('Enter description for Other Charge:');
  if (!desc || !desc.trim()) return;
  const maxOrd = wfCostings.reduce((m, c) => Math.max(m, _wfNum(c.OrdBy)), 290);
  wfCostings.push({
    OrdBy: maxOrd + 10,
    Description: desc.trim(),
    Aud1: null, Aud2: null, Aud3: null,
    OtherCharge_Amount: 0,
    OtherCharges: true,
    TotalCalc: true,
    DataEntry: true,
    FromTemplate: false,
    Comments: ''
  });
  recalcWorkflowCostings(true);
}

function pullQuoteFromCostings() {
  if (document.getElementById('wfNoAutoUpdateQuote')?.checked) {
    alert('"Don\'t Auto-Update Quote from Costing" is checked. Uncheck it to pull charges from Costings.');
    return;
  }
  const prog = document.getElementById('wfProgram')?.value || '';
  const sumCols = (ord) => {
    const r = _findCostRow(ord);
    return r ? round2(_wfNum(r.Aud1) + _wfNum(r.Aud2) + _wfNum(r.Aud3) + _wfNum(r.OtherCharge_Amount)) : 0;
  };
  const sumQty = (ord) => {
    const r = _findCostRow(ord);
    return r ? round2(_wfNum(r.Aud1) + _wfNum(r.Aud2) + _wfNum(r.Aud3)) : 0;
  };

  const txs = [];
  let order = 10;
  const pushTx = (qty, unit, cat, desc, unitPrice) => {
    if (unitPrice <= 0 || qty <= 0) return;
    txs.push({
      Order: order,
      Quantity: qty,
      Unit: unit,
      Category: cat,
      Description: desc,
      Unit_Price: round2(unitPrice),
      Line_Total: round2(qty * unitPrice),
      Vat_Perc: 0
    });
    order += 10;
  };

  const mandays = sumQty(10);
  const auditFee = sumCols(20);
  if (auditFee > 0) pushTx(mandays || 1, 'Manday', 'Audit Fee', prog ? `${prog} Audit` : 'Audit Fee', auditFee / (mandays || 1));

  const reports = sumQty(30);
  const reportFee = sumCols(40);
  if (reportFee > 0) pushTx(reports || 1, 'Unit', 'Report Writing', prog ? `${prog} Report Writing` : 'Report Writing', reportFee / (reports || 1));

  const prepMandays = sumQty(50);
  const prepFee = sumCols(55);
  if (prepFee > 0) pushTx(prepMandays || 1, 'Manday', 'Preparation Audit', prog ? `${prog} Preparation` : 'Audit Preparation', prepFee / (prepMandays || 1));

  const kmCost = sumCols(90);
  if (kmCost > 0) pushTx(1, 'Unit', 'Road Travel', 'Road Travel (KMs)', kmCost);

  const ttCost = sumCols(140);
  if (ttCost > 0) pushTx(1, 'Unit', 'Travel Time', 'Driving Travel Time', ttCost);

  const hotelNights = sumQty(160);
  const hotelTotal = sumCols(170);
  if (hotelTotal > 0) pushTx(hotelNights || 1, 'Night', 'Hotel', 'Hotel Accommodation', hotelTotal / (hotelNights || 1));

  const dinners = sumQty(190);
  const dinnerTotal = sumCols(200);
  if (dinnerTotal > 0) pushTx(dinners || 1, 'Unit', 'Dinner', 'Dinners', dinnerTotal / (dinners || 1));

  const lunches = sumQty(220);
  const lunchTotal = sumCols(230);
  if (lunchTotal > 0) pushTx(lunches || 1, 'Unit', 'Lunch', 'Lunches', lunchTotal / (lunches || 1));

  const travelExtras = [
    [240, 'Flights', 'Flights'],
    [245, 'International Travel Time', 'International Travel Time'],
    [250, 'Airport Parking', 'Airport Parking'],
    [260, 'Public Transport', 'Public Transport'],
    [270, 'Taxis', 'Taxis'],
    [280, 'Car Hire', 'Car Hire'],
    [290, 'Visas', 'Visas']
  ];
  travelExtras.forEach(([ord, cat, label]) => {
    const val = sumCols(ord);
    if (val > 0) pushTx(1, 'Unit', cat, label, val);
  });

  // Any custom Other charges (> 290)
  wfCostings.filter(c => _wfNum(c.OrdBy) > 290).forEach(c => {
    const val = round2(_wfNum(c.Aud1) + _wfNum(c.Aud2) + _wfNum(c.Aud3) + _wfNum(c.OtherCharge_Amount));
    if (val > 0) pushTx(1, 'Unit', 'Other', c.Description || 'Other Charge', val);
  });

  wfQuoteTransactions = txs;
  renderWorkflowQuoteTab();
}

const WF_QUOTE_UNITS = ['Manday', 'Hours', 'Unit'];
const WF_QUOTE_CATEGORIES = [
  'Audit Fee', 'Report Writing', 'Road Travel', 'Travel Time',
  'Hotel', 'Dinner', 'Lunch', 'OPE', 'Flights', 'Car Hire',
  'Taxis', 'Visas', 'Other', 'Preparation Audit'
];

function _buildSelectOptions(baseOptions, currentVal) {
  const opts = [...baseOptions];
  if (currentVal && !opts.includes(currentVal)) opts.push(currentVal);
  return opts.map(o => `<option value="${_wfEsc(o)}" ${o === currentVal ? 'selected' : ''}>${_wfEsc(o)}</option>`).join('');
}

function renderWorkflowQuoteTab() {
  const q = wfQuote || {};
  document.getElementById('wfQuoteStatus').value = q.Quote_Status || 'Preparing';
  document.getElementById('wfQuoteRef').value = q.QuoteRef || '';
  document.getElementById('wfQuoteYourRef').value = q.Reference || '';
  document.getElementById('wfQuotePO').value = q.PO_Number || '';
  document.getElementById('wfQuoteValidTo').value = _wfDateVal(q.Quote_ValidTo);
  document.getElementById('wfQuoteSentDate').value = _wfDateVal(q.Date_Submitted);
  document.getElementById('wfQuoteOutcomeDate').value = _wfDateVal(q.Outcome_Date);
  document.getElementById('wfQuoteDiscount').value = q.Discount ?? 0;

  const tbody = document.getElementById('wfQuoteTxBody');
  if (!tbody) return;
  if (!wfQuoteTransactions.length) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:#64748b;padding:1.25rem;">No quote line items yet. Click "Pull from Costings" or "+ Add Line Item".</td></tr>';
  } else {
    tbody.innerHTML = wfQuoteTransactions.map((t, idx) => {
      const lineTotal = round2(_wfNum(t.Quantity) * _wfNum(t.Unit_Price));
      t.Line_Total = lineTotal;
      const unitPriceStr = _wfNum(t.Unit_Price).toFixed(2);
      const curUnit = t.Unit || 'Unit';
      const curCat = t.Category || '';
      return `
        <tr>
          <td style="width:48px;"><input type="number" class="wf-cost-input" style="text-align:center;" value="${t.Order ?? (idx + 1) * 10}" onchange="wfQuoteTransactions[${idx}].Order = parseInt(this.value || 10);"></td>
          <td style="width:58px;"><input type="number" step="0.25" class="wf-cost-input" value="${t.Quantity ?? 1}" onchange="wfQuoteTransactions[${idx}].Quantity = parseFloat(this.value || 0); renderWorkflowQuoteTab();"></td>
          <td style="width:76px;"><select class="wf-input-sm" onchange="wfQuoteTransactions[${idx}].Unit = this.value;">${_buildSelectOptions(WF_QUOTE_UNITS, curUnit)}</select></td>
          <td style="width:135px;"><select class="wf-input-sm" onchange="wfQuoteTransactions[${idx}].Category = this.value;"><option value="">--</option>${_buildSelectOptions(WF_QUOTE_CATEGORIES, curCat)}</select></td>
          <td style="width:125px;"><input type="text" class="wf-input-sm" list="wfProductCodesList" placeholder="Product Code" value="${_wfEsc(t.Code || '')}" onchange="onQuoteCodeChange(${idx}, this.value)"></td>
          <td style="width:155px;"><input type="text" class="wf-input-sm" value="${_wfEsc(t.Tegenrekening || '')}" onchange="wfQuoteTransactions[${idx}].Tegenrekening = this.value;"></td>
          <td><input type="text" class="wf-input-sm" value="${_wfEsc(t.Description || '')}" onchange="wfQuoteTransactions[${idx}].Description = this.value;"></td>
          <td style="width:88px;"><input type="number" step="0.01" class="wf-cost-input" value="${unitPriceStr}" onblur="this.value = _wfNum(this.value).toFixed(2);" onchange="wfQuoteTransactions[${idx}].Unit_Price = round2(parseFloat(this.value || 0)); renderWorkflowQuoteTab();"></td>
          <td style="width:56px;"><input type="number" step="0.5" class="wf-cost-input" value="${t.Vat_Perc ?? 0}" onchange="wfQuoteTransactions[${idx}].Vat_Perc = parseFloat(this.value || 0); renderWorkflowQuoteTab();"></td>
          <td class="wf-line-total-cell" style="width:92px;">${_wfEur(lineTotal)}</td>
          <td style="width:28px;text-align:center;"><button type="button" class="wf-btn-del" onclick="wfQuoteTransactions.splice(${idx}, 1); renderWorkflowQuoteTab();" title="Remove line">&times;</button></td>
        </tr>
      `;
    }).join('');
  }
  recalcQuoteTotals();
}

function onQuoteCodeChange(idx, val) {
  const tx = wfQuoteTransactions[idx];
  if (!tx) return;
  tx.Code = val;
  const codes = wfLookups?.product_codes || [];
  const norm = (val || '').trim().toLowerCase();
  const match = codes.find(p => (p.Code || '').trim().toLowerCase() === norm || (p.Omschrijving || '').trim().toLowerCase() === norm);
  if (match) {
    tx.Tegenrekening = match.Tegenrekening || '';
    if (!tx.Description || !tx.Description.trim()) {
      tx.Description = match.Omschrijving || '';
    }
    renderWorkflowQuoteTab();
  }
}

function addQuoteLineItem() {
  const maxOrd = wfQuoteTransactions.reduce((m, t) => Math.max(m, _wfNum(t.Order)), 0);
  wfQuoteTransactions.push({
    Order: maxOrd + 10,
    Quantity: 1,
    Unit: 'Unit',
    Category: 'Other',
    Code: '',
    Tegenrekening: '',
    Description: '',
    Unit_Price: 0,
    Vat_Perc: 0,
    Line_Total: 0
  });
  renderWorkflowQuoteTab();
}

function recalcQuoteTotals() {
  let sub = 0, vat = 0;
  wfQuoteTransactions.forEach(t => {
    const lt = round2(_wfNum(t.Quantity) * _wfNum(t.Unit_Price));
    t.Line_Total = lt;
    const vp = _wfNum(t.Vat_Perc);
    sub += lt;
    vat += round2(lt * (vp / 100.0));
  });
  const discPct = _wfNum(document.getElementById('wfQuoteDiscount')?.value);
  const discAmt = round2(sub * (discPct / 100.0));
  sub = round2(sub - discAmt);
  const tot = round2(sub + vat);

  wfQuote.Quote_SubTotal = sub;
  wfQuote.Quote_VAT = round2(vat);
  wfQuote.Quote_Total = tot;
  wfQuote.Discount = discPct;
  wfQuote.Disc_Amount = discAmt;

  const el = document.getElementById('wfQuoteTotalsBox');
  if (el) {
    el.innerHTML = `
      <div><span>Subtotal (ex VAT):</span> <strong>${_wfEur(sub)}</strong></div>
      <div><span>VAT:</span> <strong>${_wfEur(vat)}</strong></div>
      <div class="wf-grand-total"><span>Total (incl. VAT):</span> <strong>${_wfEur(tot)}</strong></div>
    `;
  }
}

function setQuoteStatusAction(newStatus) {
  document.getElementById('wfQuoteStatus').value = newStatus;
  if (newStatus === 'Sent to Client' && !document.getElementById('wfQuoteSentDate').value) {
    document.getElementById('wfQuoteSentDate').value = new Date().toISOString().substring(0, 10);
  }
  if ((newStatus === 'Accepted' || newStatus === 'Declined') && !document.getElementById('wfQuoteOutcomeDate').value) {
    document.getElementById('wfQuoteOutcomeDate').value = new Date().toISOString().substring(0, 10);
  }
}

function previewWorkflowQuote() {
  if (!wfCurrentId) {
    alert('Please save the workflow first before previewing the quote.');
    return;
  }
  const modal = document.getElementById('quotePreviewModal');
  const frame = document.getElementById('quotePreviewFrame');
  const hideAud = document.getElementById('wfHideAuditorNameQuote')?.checked ? 1 : 0;
  if (modal && frame) {
    frame.src = `/api/workflows/${wfCurrentId}/quote-preview?hide_auditors=${hideAud}&t=${Date.now()}`;
    modal.style.display = 'flex';
  }
}

function closeQuotePreviewModal() {
  const modal = document.getElementById('quotePreviewModal');
  const frame = document.getElementById('quotePreviewFrame');
  if (modal) modal.style.display = 'none';
  if (frame) frame.src = 'about:blank';
}

function printQuotePreviewFrame() {
  const frame = document.getElementById('quotePreviewFrame');
  if (frame && frame.contentWindow) {
    frame.contentWindow.focus();
    frame.contentWindow.print();
  }
}

function _collectWorkflowPayload(statusOverride = null) {
  const numOrNull = (id) => {
    const v = document.getElementById(id)?.value;
    return (v === '' || v === undefined || v === null) ? null : Number(v);
  };
  const strOrNull = (id) => {
    const v = document.getElementById(id)?.value;
    return (v === '' || v === undefined || v === null) ? null : v;
  };

  let t1 = 0, t2 = 0, t3 = 0, tOther = 0;
  wfCostings.forEach(c => {
    if (c.TotalCalc) {
      t1 += _wfNum(c.Aud1); t2 += _wfNum(c.Aud2); t3 += _wfNum(c.Aud3); tOther += _wfNum(c.OtherCharge_Amount);
    }
  });

  const wf = {
    Status: statusOverride || strOrNull('wfStatus') || 'Pending',
    Project_Nr: strOrNull('wfProjectNr'),
    Audit_Confirmed: document.getElementById('wfAuditConfirmed')?.checked ? 1 : 0,
    Certification_Body: numOrNull('wfCB'),
    AuditeeID: numOrNull('wfAuditee'),
    SiteID: numOrNull('wfSite'),
    Audit_Program: strOrNull('wfProgram'),
    Audit_Type: strOrNull('wfAuditType'),
    Announcement: strOrNull('wfAnnouncement'),
    Audit_Deadline: strOrNull('wfDeadline'),
    Audit_Start_Date: strOrNull('wfStartDate'),
    Audit_End_Date: strOrNull('wfEndDate'),
    AuditWindow_From: strOrNull('wfWindowFrom'),
    AuditWindow_To: strOrNull('wfWindowTo'),
    Audit_Days: numOrNull('wfAuditDays'),
    Single_Multi_Prog: strOrNull('wfSingleMultiProg'),
    Single_Multi_Site: strOrNull('wfSingleMultiSite'),
    Nr_Sites: numOrNull('wfNrSites'),
    Cost_NrEmployees: numOrNull('wfNrWorkers'),
    Mandays_Required: numOrNull('wfMandaysReq'),
    Total_Mandays: numOrNull('wfTotalMandays'),
    Auditor1: numOrNull('wfAuditor1'),
    Auditor2: numOrNull('wfAuditor2'),
    Auditor3: numOrNull('wfAuditor3'),
    Witness_Auditor: numOrNull('wfWitnessAuditor'),
    Quote_NoAutoUpdate: document.getElementById('wfNoAutoUpdateQuote')?.checked ? 1 : 0,
    Hide_AuditorName_Quote: document.getElementById('wfHideAuditorNameQuote')?.checked ? 1 : 0,
    Cost_Total_Aud1: round2(t1),
    Cost_Total_Aud2: round2(t2),
    Cost_Total_Aud3: round2(t3),
    Cost_Total_Other: round2(tOther),
    Cost_Total_All: round2(t1 + t2 + t3 + tOther),
    Cost_MandayRate_Day: wfRates ? wfRates.manday_rate : null,
    Cost_MandayRate_perHour: wfRates ? wfRates.manday_hour_rate : null,
    Report_Fee: wfRates ? wfRates.report_fee : null,
    Amount_Quoted: wfQuote.Quote_SubTotal ?? null,
    FollowUp_AuditRequired: strOrNull('wfFollowUpAudit'),
    FollowUp_DesktopRequired: strOrNull('wfFollowUpDesktop'),
    Purchase_Ord_Nr: strOrNull('wfPONr'),
    Invoiced: document.getElementById('wfInvoiced')?.checked ? 1 : 0,
    Inv_Number: strOrNull('wfInvNr'),
    Inv_Amount: numOrNull('wfInvAmt'),
    Link_Sharepoint: strOrNull('wfLinkSharepoint'),
    Link_CertIQ: strOrNull('wfLinkCertIQ'),
    Link_Certificate: strOrNull('wfLinkCertificate'),
    Link_FSSCPortal: strOrNull('wfLinkFSSC'),
    Email_QuoteRequest_Details: strOrNull('wfEmailDetails'),
    Quote_Addit_Comments: strOrNull('wfQuoteAdditComments')
  };

  recalcQuoteTotals();
  const quote = {
    Quote_Status: strOrNull('wfQuoteStatus') || 'Preparing',
    QuoteRef: strOrNull('wfQuoteRef'),
    Reference: strOrNull('wfQuoteYourRef'),
    PO_Number: strOrNull('wfQuotePO'),
    Quote_ValidTo: strOrNull('wfQuoteValidTo'),
    Date_Submitted: strOrNull('wfQuoteSentDate'),
    Outcome_Date: strOrNull('wfQuoteOutcomeDate'),
    Discount: numOrNull('wfQuoteDiscount'),
    Disc_Amount: wfQuote.Disc_Amount ?? 0,
    Quote_SubTotal: wfQuote.Quote_SubTotal ?? 0,
    Quote_VAT: wfQuote.Quote_VAT ?? 0,
    Quote_Total: wfQuote.Quote_Total ?? 0
  };

  return {
    workflow: wf,
    distances: wfDistances,
    costings: wfCostings,
    quote: quote,
    quote_transactions: wfQuoteTransactions
  };
}

async function saveWorkflowModal(closeAfter = false, statusOverride = null) {
  const payload = _collectWorkflowPayload(statusOverride);
  if (statusOverride === 'Cancelled') {
    const reason = prompt('Enter cancellation reason:');
    if (reason === null) return;
    payload.workflow.Cancelled_Reason = reason;
  }

  const url = wfCurrentId ? `/api/workflows/${wfCurrentId}` : '/api/workflows';
  const method = wfCurrentId ? 'PUT' : 'POST';
  const btn = document.getElementById('btnSaveWorkflow');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  try {
    const resp = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const res = await resp.json();
    if (!resp.ok) throw new Error(res.detail || 'Save failed');

    wfCurrentId = res.wfid;
    if (typeof loadAuditsList === 'function') loadAuditsList();
    if (closeAfter) {
      closeWorkflowModal(true);
    } else {
      await openWorkflowModal(wfCurrentId);
    }
  } catch (err) {
    alert('Save Error: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
  }
}
