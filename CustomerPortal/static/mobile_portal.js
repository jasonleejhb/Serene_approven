/**
 * Approven Mobile Customer Portal Client JS
 */

let mCurrentTab = 'overview';
let mQuotes = [];
let mAudits = [];
let mDocs = [];
let mQuoteFilter = 'All';
let mAuditFilter = 'All';

document.addEventListener('DOMContentLoaded', () => {
  initMobileNav();
  initSideDrawer();
  loadAllMobileData();
});

function initSideDrawer() {
  const hamburgerBtn = document.getElementById('hamburgerBtn');
  const drawerBackdrop = document.getElementById('drawerBackdrop');
  const drawerPanel = document.getElementById('drawerPanel');
  const drawerCloseBtn = document.getElementById('drawerCloseBtn');

  function openDrawer() {
    drawerBackdrop.classList.add('open');
    drawerPanel.classList.add('open');
  }

  function closeDrawer() {
    drawerBackdrop.classList.remove('open');
    drawerPanel.classList.remove('open');
  }

  if (hamburgerBtn) hamburgerBtn.addEventListener('click', openDrawer);
  if (drawerBackdrop) drawerBackdrop.addEventListener('click', closeDrawer);
  if (drawerCloseBtn) drawerCloseBtn.addEventListener('click', closeDrawer);

  document.querySelectorAll('.drawer-link[data-m-target]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = link.getAttribute('data-m-target');
      closeDrawer();
      switchMobileTab(target);
    });
  });
}

function initMobileNav() {
  const tabBtns = document.querySelectorAll('.nav-tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      switchMobileTab(tab);
    });
  });
}

function switchMobileTab(tabId) {
  mCurrentTab = tabId;

  // Update bottom tab buttons
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    if (btn.getAttribute('data-tab') === tabId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Update views
  document.querySelectorAll('.mobile-view').forEach(view => {
    if (view.id === `mview-${tabId}`) {
      view.classList.add('active');
    } else {
      view.classList.remove('active');
    }
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (tabId === 'overview') loadMobileSummary();
  else if (tabId === 'quotes') loadMobileQuotes();
  else if (tabId === 'audits') loadMobileAudits();
  else if (tabId === 'documents') loadMobileDocuments();
  else if (tabId === 'profile') loadMobileProfile();
}

async function loadAllMobileData() {
  await loadMobileSummary();
  await loadMobileQuotes();
  await loadMobileAudits();
  await loadMobileDocuments();
}

// -------------------------------------------------------------
// Formatters
// -------------------------------------------------------------
function formatCurrency(val) {
  if (val === null || val === undefined || isNaN(val)) return '€0.00';
  return '€' + Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr.split('T')[0];
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 KB';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getStatusBadge(status) {
  const s = (status || '').toLowerCase();
  if (s === 'accepted' || s === 'complete' || s === 'confirmed') {
    return `<span class="badge success">${status}</span>`;
  }
  if (s === 'pending' || s === 'preparing' || s === 'sent to client') {
    return `<span class="badge warning">${status}</span>`;
  }
  if (s === 'declined' || s === 'cancelled') {
    return `<span class="badge danger">${status}</span>`;
  }
  return `<span class="badge" style="background:#e2e8f0; color:#475569;">${status || 'Unknown'}</span>`;
}

// -------------------------------------------------------------
// Overview Summary
// -------------------------------------------------------------
async function loadMobileSummary() {
  try {
    const res = await fetch('/customerportal/api/summary');
    if (res.status === 401) {
      window.location.href = '/customerportal/m/login';
      return;
    }
    const data = await res.json();
    if (data.success && data.stats) {
      const s = data.stats;
      document.getElementById('mStatQuotes').textContent = s.total_quotes || 0;
      document.getElementById('mStatQuotedVal').textContent = formatCurrency(s.total_quoted_value || 0);
      document.getElementById('mStatAudits').textContent = s.total_audits || 0;
      document.getElementById('mStatConfirmedAudits').textContent = s.confirmed_audits || 0;
      document.getElementById('mStatDocs').textContent = s.total_documents || 0;
    }
  } catch (err) {
    console.error('Error loading mobile summary:', err);
  }
}

// -------------------------------------------------------------
// Mobile Quotes
// -------------------------------------------------------------
async function loadMobileQuotes() {
  const container = document.getElementById('mQuotesContainer');
  container.innerHTML = '<div style="text-align:center; padding:30px; color:#64748b;"><i class="fa-solid fa-spinner fa-spin"></i> Loading quotes...</div>';

  try {
    const res = await fetch('/customerportal/api/quotes');
    const data = await res.json();
    if (data.success) {
      mQuotes = data.quotes || [];
      renderMobileQuotes();
      populateMobileAuditSelect();
    }
  } catch (e) {
    container.innerHTML = '<div style="text-align:center; padding:30px; color:#ef4444;">Error loading quotes.</div>';
  }
}

function filterMobileQuotes(status, el) {
  mQuoteFilter = status;
  document.querySelectorAll('#mQuoteFilters .m-filter-pill').forEach(p => p.classList.remove('active'));
  if (el) el.classList.add('active');
  renderMobileQuotes();
}

function renderMobileQuotes() {
  const container = document.getElementById('mQuotesContainer');
  const search = (document.getElementById('mQuotesSearch').value || '').toLowerCase().trim();

  let filtered = mQuotes.filter(q => {
    const matchStatus = mQuoteFilter === 'All' || q.Quote_Status === mQuoteFilter;
    const matchSearch = !search ||
      (q.QuoteRef && q.QuoteRef.toLowerCase().includes(search)) ||
      (q.Auditee_Name && q.Auditee_Name.toLowerCase().includes(search));
    return matchStatus && matchSearch;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div style="text-align:center; padding:40px 20px; color:#64748b;"><i class="fa-regular fa-folder-open" style="font-size:32px; margin-bottom:8px;"></i><p>No quotations found</p></div>';
    return;
  }

  container.innerHTML = filtered.map(q => `
    <div class="m-card" onclick="openQuoteSheet(${q.QuoteID})">
      <div class="m-card-header">
        <div>
          <div class="m-card-title">${escapeHtml(q.QuoteRef || 'Quote')}</div>
          <div class="m-card-subtitle">${escapeHtml(q.Auditee_Name || 'Unassigned')}</div>
        </div>
        ${getStatusBadge(q.Quote_Status)}
      </div>
      <div class="m-card-row">
        <span>Program:</span>
        <strong>${escapeHtml(q.Audit_Program || 'Standard')}</strong>
      </div>
      <div class="m-card-row">
        <span>Valid Until:</span>
        <span>${formatDate(q.Quote_ValidTo)}</span>
      </div>
      <div class="m-card-row" style="margin-top:10px; border-top:1px solid var(--slate-100); padding-top:8px;">
        <span style="font-weight:700; color:var(--slate-900);">Total Quoted:</span>
        <strong style="color:var(--primary); font-size:14px;">${formatCurrency(q.Quote_Total)}</strong>
      </div>
    </div>
  `).join('');
}

async function openQuoteSheet(quoteId) {
  try {
    const res = await fetch(`/customerportal/api/quotes/${quoteId}`);
    const data = await res.json();
    if (!data.success || !data.quote) return;
    const q = data.quote;

    document.getElementById('mSheetTitle').textContent = q.QuoteRef || 'Quote Details';
    document.getElementById('mSheetBody').innerHTML = `
      <div style="margin-bottom:16px;">
        <div style="font-size:12px; color:#64748b;">Auditee / Client</div>
        <div style="font-size:16px; font-weight:800; color:#0f172a;">${escapeHtml(q.Auditee_Name || 'N/A')}</div>
        <div style="font-size:13px; color:#475569;">${escapeHtml(q.Auditee_Address || '')} ${escapeHtml(q.Auditee_Country || '')}</div>
      </div>

      <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:12px; margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
          <span style="color:#64748b; font-size:13px;">Status:</span>
          ${getStatusBadge(q.Quote_Status)}
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:13px;">
          <span style="color:#64748b;">Created Date:</span>
          <strong>${formatDate(q.Quote_Created)}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:13px;">
          <span style="color:#64748b;">Valid Until:</span>
          <strong>${formatDate(q.Quote_ValidTo)}</strong>
        </div>
      </div>

      <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:12px; padding:12px; margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px;">
          <span>SubTotal (excl. VAT):</span>
          <span>${formatCurrency(q.Quote_SubTotal)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px;">
          <span>VAT:</span>
          <span>${formatCurrency(q.Quote_VAT)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:15px; font-weight:800; color:#15803d; border-top:1px solid #bbf7d0; padding-top:6px;">
          <span>Total Quoted:</span>
          <span>${formatCurrency(q.Quote_Total)}</span>
        </div>
      </div>

      <div style="font-size:13px; color:#334155; line-height:1.5;">
        <div><strong>Program:</strong> ${escapeHtml(q.Audit_Program || 'Standard')}</div>
        <div><strong>Mandays:</strong> ${q.Total_Mandays || 'N/A'}</div>
        ${q.Comments ? `<div style="margin-top:8px;"><strong>Comments:</strong> ${escapeHtml(q.Comments)}</div>` : ''}
      </div>
    `;

    openBottomSheet();
  } catch (err) {
    console.error(err);
  }
}

// -------------------------------------------------------------
// Mobile Audits
// -------------------------------------------------------------
async function loadMobileAudits() {
  const container = document.getElementById('mAuditsContainer');
  container.innerHTML = '<div style="text-align:center; padding:30px; color:#64748b;"><i class="fa-solid fa-spinner fa-spin"></i> Loading audits...</div>';

  try {
    const res = await fetch('/customerportal/api/audits');
    const data = await res.json();
    if (data.success) {
      mAudits = data.audits || [];
      renderMobileAudits();
      populateMobileAuditSelect();
    }
  } catch (e) {
    container.innerHTML = '<div style="text-align:center; padding:30px; color:#ef4444;">Error loading audits.</div>';
  }
}

function filterMobileAudits(status, el) {
  mAuditFilter = status;
  document.querySelectorAll('#mAuditFilters .m-filter-pill').forEach(p => p.classList.remove('active'));
  if (el) el.classList.add('active');
  renderMobileAudits();
}

function renderMobileAudits() {
  const container = document.getElementById('mAuditsContainer');
  const search = (document.getElementById('mAuditsSearch').value || '').toLowerCase().trim();

  let filtered = mAudits.filter(a => {
    const matchStatus = mAuditFilter === 'All' || a.Status === mAuditFilter;
    const matchSearch = !search ||
      (a.Project_Nr && a.Project_Nr.toLowerCase().includes(search)) ||
      (a.Auditee_Name && a.Auditee_Name.toLowerCase().includes(search));
    return matchStatus && matchSearch;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div style="text-align:center; padding:40px 20px; color:#64748b;"><i class="fa-solid fa-clipboard-check" style="font-size:32px; margin-bottom:8px;"></i><p>No audits found</p></div>';
    return;
  }

  container.innerHTML = filtered.map(a => `
    <div class="m-card" onclick="openAuditSheet(${a.WFID})">
      <div class="m-card-header">
        <div>
          <div class="m-card-title">Audit WF-${a.WFID}</div>
          <div class="m-card-subtitle">${escapeHtml(a.Auditee_Name || 'Auditee')}</div>
        </div>
        ${getStatusBadge(a.Status)}
      </div>
      <div class="m-card-row">
        <span>Program:</span>
        <strong>${escapeHtml(a.Audit_Program || 'Standard')}</strong>
      </div>
      <div class="m-card-row">
        <span>Dates:</span>
        <span>${formatDate(a.Audit_Start_Date)} &mdash; ${formatDate(a.Audit_End_Date)}</span>
      </div>
      <div class="m-card-row">
        <span>Mandays:</span>
        <strong>${a.Total_Mandays || '-'}</strong>
      </div>
    </div>
  `).join('');
}

async function openAuditSheet(wfid) {
  try {
    const res = await fetch(`/customerportal/api/audits/${wfid}`);
    const data = await res.json();
    if (!data.success || !data.audit) return;
    const a = data.audit;

    document.getElementById('mSheetTitle').textContent = `Audit Workflow #${a.WFID}`;
    document.getElementById('mSheetBody').innerHTML = `
      <div style="margin-bottom:16px;">
        <div style="font-size:12px; color:#64748b;">Auditee & Site</div>
        <div style="font-size:16px; font-weight:800; color:#0f172a;">${escapeHtml(a.Auditee_Name || 'N/A')}</div>
        <div style="font-size:13px; color:#475569;">${escapeHtml(a.Auditee_Address || '')} ${escapeHtml(a.Site_City || '')}</div>
      </div>

      <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:12px; margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
          <span style="color:#64748b; font-size:13px;">Status:</span>
          ${getStatusBadge(a.Status)}
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:13px;">
          <span style="color:#64748b;">Audit Dates:</span>
          <strong>${formatDate(a.Audit_Start_Date)} to ${formatDate(a.Audit_End_Date)}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:13px;">
          <span style="color:#64748b;">Mandays:</span>
          <strong>${a.Total_Mandays || 'N/A'}</strong>
        </div>
      </div>

      <div style="font-size:13px; color:#334155; line-height:1.5;">
        <div><strong>Program:</strong> ${escapeHtml(a.Audit_Program || 'Standard')}</div>
        <div><strong>Standard:</strong> ${escapeHtml(a.Cert_Type_Standard || 'N/A')}</div>
        <div><strong>Quoted Amount:</strong> ${formatCurrency(a.Amount_Quoted)}</div>
        <div><strong>Invoice Nr:</strong> ${escapeHtml(a.Invoice_Nr || 'Pending')}</div>
      </div>
    `;

    openBottomSheet();
  } catch (err) {
    console.error(err);
  }
}

// -------------------------------------------------------------
// Mobile Documents
// -------------------------------------------------------------
async function loadMobileDocuments() {
  const container = document.getElementById('mDocsContainer');
  container.innerHTML = '<div style="text-align:center; padding:30px; color:#64748b;"><i class="fa-solid fa-spinner fa-spin"></i> Loading documents...</div>';

  try {
    const res = await fetch('/customerportal/api/documents');
    const data = await res.json();
    if (data.success) {
      mDocs = data.documents || [];
      renderMobileDocuments();
    }
  } catch (e) {
    container.innerHTML = '<div style="text-align:center; padding:30px; color:#ef4444;">Error loading documents.</div>';
  }
}

function renderMobileDocuments() {
  const container = document.getElementById('mDocsContainer');
  const search = (document.getElementById('mDocsSearch').value || '').toLowerCase().trim();

  let filtered = mDocs.filter(d => {
    return !search || (d.FileName && d.FileName.toLowerCase().includes(search)) || (d.DocumentType && d.DocumentType.toLowerCase().includes(search));
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div style="text-align:center; padding:40px 20px; color:#64748b;"><i class="fa-regular fa-file-lines" style="font-size:32px; margin-bottom:8px;"></i><p>No documents uploaded yet</p></div>';
    return;
  }

  container.innerHTML = filtered.map(d => `
    <div class="m-card">
      <div class="m-card-header">
        <div style="display:flex; align-items:center; gap:10px;">
          <i class="fa-solid fa-file-lines" style="font-size:22px; color:var(--primary);"></i>
          <div>
            <div class="m-card-title" style="font-size:14px;">${escapeHtml(d.FileName)}</div>
            <div class="m-card-subtitle">${escapeHtml(d.DocumentType || 'General')} &bull; ${formatFileSize(d.FileSize)}</div>
          </div>
        </div>
      </div>
      <div class="m-card-row" style="margin-top:10px; border-top:1px solid var(--slate-100); padding-top:8px;">
        <span style="font-size:11px; color:#94a3b8;">${formatDate(d.UploadedAt)}</span>
        <div style="display:flex; gap:8px;">
          <a href="/customerportal/api/documents/${d.DocumentID}/download" class="badge info" style="text-decoration:none; padding:6px 12px; font-size:12px;">
            <i class="fa-solid fa-download"></i> Download
          </a>
          <button onclick="deleteMobileDoc(${d.DocumentID})" class="badge danger" style="border:none; cursor:pointer; padding:6px 10px; font-size:12px;">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

function populateMobileAuditSelect() {
  const sel = document.getElementById('mUploadWfid');
  if (!sel) return;
  let opts = '<option value="">-- General / None --</option>';
  mAudits.forEach(a => {
    opts += `<option value="${a.WFID}">Audit WF-${a.WFID} (${a.Auditee_Name || 'Auditee'})</option>`;
  });
  sel.innerHTML = opts;
}

async function handleMobileUpload(e) {
  e.preventDefault();
  const fileInput = document.getElementById('mFileInput');
  if (!fileInput.files || fileInput.files.length === 0) {
    alert('Please select a file to upload.');
    return;
  }

  const btn = document.getElementById('mUploadBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading...';

  const fd = new FormData();
  fd.append('file', fileInput.files[0]);
  fd.append('document_type', document.getElementById('mUploadType').value);
  const wfid = document.getElementById('mUploadWfid').value;
  if (wfid) fd.append('wfid', wfid);
  const desc = document.getElementById('mUploadDesc').value;
  if (desc) fd.append('description', desc);

  try {
    const res = await fetch('/customerportal/api/documents/upload', {
      method: 'POST',
      body: fd
    });
    const data = await res.json();
    if (res.ok && data.success) {
      alert('Document uploaded successfully!');
      fileInput.value = '';
      document.getElementById('mUploadDesc').value = '';
      loadMobileDocuments();
      loadMobileSummary();
    } else {
      alert(data.message || 'Upload failed.');
    }
  } catch (err) {
    alert('Error uploading document.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Upload File</span> <i class="fa-solid fa-cloud-arrow-up"></i>';
  }
}

async function deleteMobileDoc(docId) {
  if (!confirm('Are you sure you want to delete this document?')) return;
  try {
    const res = await fetch(`/customerportal/api/documents/${docId}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok && data.success) {
      loadMobileDocuments();
      loadMobileSummary();
    } else {
      alert(data.message || 'Failed to delete.');
    }
  } catch (e) {
    alert('Error deleting document.');
  }
}

// -------------------------------------------------------------
// Mobile Profile
// -------------------------------------------------------------
async function loadMobileProfile() {
  try {
    const res = await fetch('/customerportal/api/profile');
    const data = await res.json();
    if (data.success && data.profile) {
      const p = data.profile;
      document.getElementById('mProfileName').textContent = p.Company_Name || 'N/A';
      document.getElementById('mProfileCode').textContent = p.Code || 'N/A';
      document.getElementById('mProfileEmail').textContent = p.Billing_Email || 'N/A';
      document.getElementById('mProfileContact').textContent = p.Billing_Contact_Name || 'N/A';
      document.getElementById('mProfileTel').textContent = p.Billing_Tel || 'N/A';
      document.getElementById('mProfileAddress').textContent = p.Billing_Physical_Address || 'N/A';

      document.getElementById('mRateManday').textContent = formatCurrency(p.Man_Day_Rate);
      document.getElementById('mRateKM').textContent = formatCurrency(p.Per_KM_Rate);
      document.getElementById('mRateTravel').textContent = formatCurrency(p.Travel_Time_Rate_perHour);
    }
  } catch (e) {
    console.error(e);
  }
}

// Bottom Sheet Helpers
function openBottomSheet() {
  document.getElementById('bottomSheet').classList.add('open');
}

function closeBottomSheet() {
  document.getElementById('bottomSheet').classList.remove('open');
}

function escapeHtml(text) {
  if (!text) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}
