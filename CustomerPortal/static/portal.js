/**
 * Approven Customer Portal Desktop Client JS
 */

let currentSection = 'dashboard';
let quotesData = [];
let auditsData = [];
let documentsData = [];
let selectedQuoteFilter = 'All';
let selectedAuditFilter = 'All';
let selectedDocFilter = 'All';

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initDragDrop();
  loadAllData();
});

function initNavigation() {
  const navBtns = document.querySelectorAll('.nav-link-btn');
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-target');
      switchSection(target);
    });
  });
}

function switchSection(sectionId) {
  currentSection = sectionId;
  
  // Update nav buttons
  document.querySelectorAll('.nav-link-btn').forEach(b => {
    if (b.getAttribute('data-target') === sectionId) {
      b.classList.add('active');
    } else {
      b.classList.remove('active');
    }
  });

  // Update sections
  document.querySelectorAll('.page-section').forEach(s => {
    if (s.id === `section-${sectionId}`) {
      s.classList.add('active');
    } else {
      s.classList.remove('active');
    }
  });

  if (sectionId === 'quotes') loadQuotes();
  else if (sectionId === 'audits') loadAudits();
  else if (sectionId === 'documents') loadDocuments();
  else if (sectionId === 'profile') loadProfile();
  else if (sectionId === 'dashboard') loadSummary();
}

async function loadAllData() {
  await loadSummary();
  await loadQuotes();
  await loadAudits();
  await loadDocuments();
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
    return `<span class="badge success"><i class="fa-solid fa-circle-check"></i> ${status}</span>`;
  }
  if (s === 'pending' || s === 'preparing' || s === 'sent to client') {
    return `<span class="badge warning"><i class="fa-solid fa-clock"></i> ${status}</span>`;
  }
  if (s === 'declined' || s === 'cancelled') {
    return `<span class="badge danger"><i class="fa-solid fa-circle-xmark"></i> ${status}</span>`;
  }
  return `<span class="badge neutral">${status || 'Unknown'}</span>`;
}

// -------------------------------------------------------------
// Dashboard Summary
// -------------------------------------------------------------
async function loadSummary() {
  try {
    const res = await fetch('/customerportal/api/summary');
    if (res.status === 401) {
      window.location.href = '/customerportal/login';
      return;
    }
    const data = await res.json();
    if (data.success && data.stats) {
      const s = data.stats;
      document.getElementById('statTotalQuotes').textContent = s.total_quotes || 0;
      document.getElementById('statQuotedVal').textContent = formatCurrency(s.total_quoted_value || 0);
      document.getElementById('statAcceptedQuotes').textContent = s.accepted_quotes || 0;
      document.getElementById('statTotalAudits').textContent = s.total_audits || 0;
      document.getElementById('statConfirmedAudits').textContent = s.confirmed_audits || 0;
      document.getElementById('statCompleteAudits').textContent = s.complete_audits || 0;
      document.getElementById('statDocumentsCount').textContent = s.total_documents || 0;
    }
  } catch (err) {
    console.error('Error loading summary:', err);
  }
}

// -------------------------------------------------------------
// Quotes Module
// -------------------------------------------------------------
async function loadQuotes() {
  const tbody = document.getElementById('quotesTableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i><p>Loading quotations...</p></td></tr>';

  try {
    const res = await fetch('/customerportal/api/quotes');
    const data = await res.json();
    if (data.success) {
      quotesData = data.quotes || [];
      renderQuotesTable();
      populateAuditAndQuoteDropdowns();
    }
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><h3>Error</h3><p>Could not load quotations.</p></td></tr>';
  }
}

function filterQuotes(status, btn) {
  selectedQuoteFilter = status;
  document.querySelectorAll('#quoteFilters .filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderQuotesTable();
}

function renderQuotesTable() {
  const tbody = document.getElementById('quotesTableBody');
  const search = (document.getElementById('quotesSearchInput').value || '').toLowerCase().trim();

  let filtered = quotesData.filter(q => {
    const matchStatus = selectedQuoteFilter === 'All' || q.Quote_Status === selectedQuoteFilter;
    const matchSearch = !search || 
      (q.QuoteRef && q.QuoteRef.toLowerCase().includes(search)) ||
      (q.Auditee_Name && q.Auditee_Name.toLowerCase().includes(search)) ||
      (q.Audit_Program && q.Audit_Program.toLowerCase().includes(search));
    return matchStatus && matchSearch;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><i class="fa-regular fa-folder-open"></i><h3>No quotations found</h3><p>No matching quotes for your selection.</p></td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(q => `
    <tr>
      <td><strong>${escapeHtml(q.QuoteRef || 'N/A')}</strong></td>
      <td>
        <div style="font-weight:600; color:var(--slate-900);">${escapeHtml(q.Auditee_Name || 'Unassigned')}</div>
        <div style="font-size:11px; color:var(--slate-500);">${escapeHtml(q.Auditee_Country || '')}</div>
      </td>
      <td>
        <div>${escapeHtml(q.Audit_Program || 'Standard Audit')}</div>
        <div style="font-size:11px; color:var(--slate-500);">${escapeHtml(q.Audit_Type || '')}</div>
      </td>
      <td>${formatDate(q.Quote_Created)}</td>
      <td>${formatDate(q.Quote_ValidTo)}</td>
      <td style="font-weight:700; color:var(--slate-900);">${formatCurrency(q.Quote_Total)}</td>
      <td>${getStatusBadge(q.Quote_Status)}</td>
      <td style="text-align:right;">
        <button class="btn-action" onclick="viewQuoteDetail(${q.QuoteID})">
          <i class="fa-solid fa-eye"></i> Details
        </button>
      </td>
    </tr>
  `).join('');
}

async function viewQuoteDetail(quoteId) {
  try {
    const res = await fetch(`/customerportal/api/quotes/${quoteId}`);
    const data = await res.json();
    if (!data.success || !data.quote) return;
    const q = data.quote;

    document.getElementById('modalQuoteRef').textContent = q.QuoteRef || `Quote #${q.QuoteID}`;
    document.getElementById('modalQuoteBody').innerHTML = `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:20px;">
        <div style="background:var(--slate-50); padding:14px; border-radius:8px; border:1px solid var(--slate-200);">
          <div style="font-size:11px; font-weight:700; color:var(--slate-500); text-transform:uppercase;">Auditee / Client</div>
          <div style="font-size:15px; font-weight:700; color:var(--slate-900); margin-top:2px;">${escapeHtml(q.Auditee_Name || 'N/A')}</div>
          <div style="font-size:12px; color:var(--slate-600); margin-top:4px;">
            ${escapeHtml(q.Auditee_Address || '')}<br>
            ${escapeHtml(q.Auditee_Country || '')}
          </div>
        </div>

        <div style="background:var(--slate-50); padding:14px; border-radius:8px; border:1px solid var(--slate-200);">
          <div style="font-size:11px; font-weight:700; color:var(--slate-500); text-transform:uppercase;">Quote Status</div>
          <div style="margin-top:6px;">${getStatusBadge(q.Quote_Status)}</div>
          <div style="font-size:12px; color:var(--slate-600); margin-top:8px;">
            <strong>Created:</strong> ${formatDate(q.Quote_Created)}<br>
            <strong>Valid Until:</strong> ${formatDate(q.Quote_ValidTo)}
          </div>
        </div>
      </div>

      <div style="margin-bottom:20px;">
        <div style="font-size:12px; font-weight:700; text-transform:uppercase; color:var(--slate-700); margin-bottom:8px;">Financial Summary</div>
        <table class="data-table" style="border:1px solid var(--slate-200); border-radius:8px;">
          <tbody>
            <tr>
              <td><strong>SubTotal (excl. VAT)</strong></td>
              <td style="text-align:right; font-weight:600;">${formatCurrency(q.Quote_SubTotal)}</td>
            </tr>
            <tr>
              <td><strong>VAT Amount</strong></td>
              <td style="text-align:right; font-weight:600;">${formatCurrency(q.Quote_VAT)}</td>
            </tr>
            <tr style="background:var(--slate-50);">
              <td style="font-size:15px; font-weight:800; color:var(--slate-900);">Total Quoted Amount</td>
              <td style="text-align:right; font-size:16px; font-weight:800; color:var(--primary);">${formatCurrency(q.Quote_Total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style="background:var(--slate-50); padding:14px; border-radius:8px; border:1px solid var(--slate-200);">
        <div style="font-size:11px; font-weight:700; color:var(--slate-500); text-transform:uppercase;">Audit Specifications</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:12px; margin-top:6px; color:var(--slate-700);">
          <div><strong>Program:</strong> ${escapeHtml(q.Audit_Program || 'Standard')}</div>
          <div><strong>Type:</strong> ${escapeHtml(q.Audit_Type || 'Initial')}</div>
          <div><strong>Total Mandays:</strong> ${q.Total_Mandays || 'N/A'}</div>
          <div><strong>Standard:</strong> ${escapeHtml(q.Cert_Type_Standard || 'N/A')}</div>
        </div>
        ${q.Comments ? `<div style="margin-top:10px; font-size:12px; color:var(--slate-600); border-top:1px solid var(--slate-200); padding-top:8px;"><strong>Comments:</strong> ${escapeHtml(q.Comments)}</div>` : ''}
      </div>
    `;

    openModal('quoteDetailModal');
  } catch (err) {
    console.error('Error fetching quote detail:', err);
  }
}

// -------------------------------------------------------------
// Audits Module
// -------------------------------------------------------------
async function loadAudits() {
  const tbody = document.getElementById('auditsTableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i><p>Loading audits...</p></td></tr>';

  try {
    const res = await fetch('/customerportal/api/audits');
    const data = await res.json();
    if (data.success) {
      auditsData = data.audits || [];
      renderAuditsTable();
      populateAuditAndQuoteDropdowns();
    }
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><h3>Error</h3><p>Could not load audits.</p></td></tr>';
  }
}

function filterAudits(status, btn) {
  selectedAuditFilter = status;
  document.querySelectorAll('#auditFilters .filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderAuditsTable();
}

function renderAuditsTable() {
  const tbody = document.getElementById('auditsTableBody');
  const search = (document.getElementById('auditsSearchInput').value || '').toLowerCase().trim();

  let filtered = auditsData.filter(a => {
    const matchStatus = selectedAuditFilter === 'All' || a.Status === selectedAuditFilter;
    const matchSearch = !search || 
      (a.Project_Nr && a.Project_Nr.toLowerCase().includes(search)) ||
      (a.Auditee_Name && a.Auditee_Name.toLowerCase().includes(search)) ||
      (a.Audit_Program && a.Audit_Program.toLowerCase().includes(search)) ||
      (a.Site_City && a.Site_City.toLowerCase().includes(search));
    return matchStatus && matchSearch;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><i class="fa-solid fa-clipboard-check"></i><h3>No audits found</h3><p>No audits matching your filter criteria.</p></td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(a => `
    <tr>
      <td><strong>WF-${a.WFID}</strong></td>
      <td>
        <div style="font-weight:600; color:var(--slate-900);">${escapeHtml(a.Auditee_Name || 'Unassigned')}</div>
        <div style="font-size:11px; color:var(--slate-500);">${escapeHtml(a.Site_City || a.Auditee_Country || '')}</div>
      </td>
      <td>
        <div>${escapeHtml(a.Audit_Program || 'Standard')}</div>
        <div style="font-size:11px; color:var(--slate-500);">${escapeHtml(a.Audit_Type || '')}</div>
      </td>
      <td>
        <div>${formatDate(a.Audit_Start_Date)}</div>
        <div style="font-size:11px; color:var(--slate-500);">to ${formatDate(a.Audit_End_Date)}</div>
      </td>
      <td>${a.Total_Mandays || '-'}</td>
      <td>${getStatusBadge(a.Status)}</td>
      <td style="text-align:right;">
        <button class="btn-action" onclick="viewAuditDetail(${a.WFID})">
          <i class="fa-solid fa-eye"></i> Details
        </button>
      </td>
    </tr>
  `).join('');
}

async function viewAuditDetail(wfid) {
  try {
    const res = await fetch(`/customerportal/api/audits/${wfid}`);
    const data = await res.json();
    if (!data.success || !data.audit) return;
    const a = data.audit;

    document.getElementById('modalAuditRef').textContent = `Audit Workflow #${a.WFID}`;
    document.getElementById('modalAuditBody').innerHTML = `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:20px;">
        <div style="background:var(--slate-50); padding:14px; border-radius:8px; border:1px solid var(--slate-200);">
          <div style="font-size:11px; font-weight:700; color:var(--slate-500); text-transform:uppercase;">Auditee & Site</div>
          <div style="font-size:15px; font-weight:700; color:var(--slate-900); margin-top:2px;">${escapeHtml(a.Auditee_Name || 'N/A')}</div>
          <div style="font-size:12px; color:var(--slate-600); margin-top:4px;">
            ${escapeHtml(a.Auditee_Address || '')}<br>
            ${escapeHtml(a.Site_City || '')} ${escapeHtml(a.Auditee_Country || '')}
          </div>
          ${a.Auditee_Contact ? `<div style="font-size:12px; color:var(--slate-600); margin-top:6px;"><strong>Contact:</strong> ${escapeHtml(a.Auditee_Contact)}</div>` : ''}
        </div>

        <div style="background:var(--slate-50); padding:14px; border-radius:8px; border:1px solid var(--slate-200);">
          <div style="font-size:11px; font-weight:700; color:var(--slate-500); text-transform:uppercase;">Audit Execution Status</div>
          <div style="margin-top:6px;">${getStatusBadge(a.Status)}</div>
          <div style="font-size:12px; color:var(--slate-600); margin-top:8px;">
            <strong>Scheduled:</strong> ${formatDate(a.Audit_Start_Date)} &mdash; ${formatDate(a.Audit_End_Date)}<br>
            <strong>Mandays:</strong> ${a.Total_Mandays || 'N/A'}<br>
            <strong>Type:</strong> ${escapeHtml(a.Announcement || 'Announced')}
          </div>
        </div>
      </div>

      <div style="background:var(--slate-50); padding:14px; border-radius:8px; border:1px solid var(--slate-200);">
        <div style="font-size:11px; font-weight:700; color:var(--slate-500); text-transform:uppercase;">Program & Invoicing</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:12px; margin-top:6px; color:var(--slate-700);">
          <div><strong>Program:</strong> ${escapeHtml(a.Audit_Program || 'N/A')}</div>
          <div><strong>Standard:</strong> ${escapeHtml(a.Cert_Type_Standard || 'N/A')}</div>
          <div><strong>Quoted Amount:</strong> ${formatCurrency(a.Amount_Quoted)}</div>
          <div><strong>Invoice Nr:</strong> ${escapeHtml(a.Invoice_Nr || 'Pending')}</div>
        </div>
      </div>
    `;

    openModal('auditDetailModal');
  } catch (err) {
    console.error('Error fetching audit detail:', err);
  }
}

// -------------------------------------------------------------
// Document Management Module
// -------------------------------------------------------------
async function loadDocuments() {
  const tbody = document.getElementById('docsTableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i><p>Loading documents...</p></td></tr>';

  try {
    const res = await fetch('/customerportal/api/documents');
    const data = await res.json();
    if (data.success) {
      documentsData = data.documents || [];
      renderDocumentsTable();
    }
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><h3>Error</h3><p>Could not load documents.</p></td></tr>';
  }
}

function filterDocuments(category, btn) {
  selectedDocFilter = category;
  document.querySelectorAll('#docFilters .filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderDocumentsTable();
}

function renderDocumentsTable() {
  const tbody = document.getElementById('docsTableBody');
  const search = (document.getElementById('docsSearchInput').value || '').toLowerCase().trim();

  let filtered = documentsData.filter(d => {
    const matchCategory = selectedDocFilter === 'All' || d.DocumentType === selectedDocFilter;
    const matchSearch = !search ||
      (d.FileName && d.FileName.toLowerCase().includes(search)) ||
      (d.Description && d.Description.toLowerCase().includes(search)) ||
      (d.UploadedBy && d.UploadedBy.toLowerCase().includes(search));
    return matchCategory && matchSearch;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><i class="fa-regular fa-file-lines"></i><h3>No documents found</h3><p>Upload documents using the form above.</p></td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(d => `
    <tr>
      <td>
        <div style="display:flex; align-items:center; gap:10px;">
          <i class="${getFileIcon(d.FileName)}" style="font-size:20px; color:var(--primary);"></i>
          <div>
            <div style="font-weight:700; color:var(--slate-900);">${escapeHtml(d.FileName)}</div>
            ${d.Description ? `<div style="font-size:11px; color:var(--slate-500);">${escapeHtml(d.Description)}</div>` : ''}
          </div>
        </div>
      </td>
      <td><span class="badge info">${escapeHtml(d.DocumentType || 'General')}</span></td>
      <td>${d.WFID ? `<strong>WF-${d.WFID}</strong>` : '-'}</td>
      <td>${formatFileSize(d.FileSize)}</td>
      <td>
        <div>${formatDate(d.UploadedAt)}</div>
        <div style="font-size:11px; color:var(--slate-500);">${escapeHtml(d.UploadedBy || '')}</div>
      </td>
      <td style="text-align:right;">
        <div style="display:inline-flex; gap:6px;">
          <a href="/customerportal/api/documents/${d.DocumentID}/download" class="btn-action" title="Download Document">
            <i class="fa-solid fa-download"></i> Download
          </a>
          <button class="btn-action btn-danger-action" onclick="deleteDocument(${d.DocumentID})" title="Delete">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

function getFileIcon(filename) {
  if (!filename) return 'fa-regular fa-file';
  const ext = filename.split('.').pop().toLowerCase();
  if (['pdf'].includes(ext)) return 'fa-solid fa-file-pdf text-danger';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'fa-solid fa-file-excel text-success';
  if (['doc', 'docx'].includes(ext)) return 'fa-solid fa-file-word text-primary';
  if (['png', 'jpg', 'jpeg', 'svg'].includes(ext)) return 'fa-solid fa-file-image';
  if (['zip', 'rar', '7z'].includes(ext)) return 'fa-solid fa-file-zipper';
  return 'fa-regular fa-file';
}

function initDragDrop() {
  const dropzone = document.getElementById('uploadDropzone');
  const fileInput = document.getElementById('docFileInput');

  if (!dropzone || !fileInput) return;

  dropzone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      document.getElementById('selectedFileName').textContent = fileInput.files[0].name;
      document.getElementById('selectedFileBox').style.display = 'block';
    }
  });

  ['dragenter', 'dragover'].forEach(name => {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(name => {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length > 0) {
      fileInput.files = e.dataTransfer.files;
      document.getElementById('selectedFileName').textContent = fileInput.files[0].name;
      document.getElementById('selectedFileBox').style.display = 'block';
    }
  });
}

function populateAuditAndQuoteDropdowns() {
  const select = document.getElementById('uploadWfidSelect');
  if (!select) return;

  let options = '<option value="">-- None / General --</option>';
  auditsData.forEach(a => {
    options += `<option value="${a.WFID}">Audit WF-${a.WFID} (${a.Auditee_Name || 'Auditee'})</option>`;
  });
  select.innerHTML = options;
}

async function handleDocumentUpload(e) {
  e.preventDefault();
  const fileInput = document.getElementById('docFileInput');
  if (!fileInput.files || fileInput.files.length === 0) {
    alert('Please select a file to upload.');
    return;
  }

  const file = fileInput.files[0];
  const docType = document.getElementById('uploadDocType').value;
  const wfid = document.getElementById('uploadWfidSelect').value;
  const desc = document.getElementById('uploadDocDesc').value;
  const btn = document.getElementById('uploadSubmitBtn');

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading...';

  const formData = new FormData();
  formData.append('file', file);
  formData.append('document_type', docType);
  if (wfid) formData.append('wfid', wfid);
  if (desc) formData.append('description', desc);

  try {
    const res = await fetch('/customerportal/api/documents/upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();

    if (res.ok && data.success) {
      alert(data.message || 'Document uploaded successfully!');
      // Reset form
      fileInput.value = '';
      document.getElementById('selectedFileBox').style.display = 'none';
      document.getElementById('uploadDocDesc').value = '';
      loadDocuments();
      loadSummary();
    } else {
      alert(data.message || 'Failed to upload document.');
    }
  } catch (err) {
    alert('Error uploading document.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Upload Document';
  }
}

async function deleteDocument(docId) {
  if (!confirm('Are you sure you want to delete this document?')) return;

  try {
    const res = await fetch(`/customerportal/api/documents/${docId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (res.ok && data.success) {
      loadDocuments();
      loadSummary();
    } else {
      alert(data.message || 'Failed to delete document.');
    }
  } catch (err) {
    alert('Error deleting document.');
  }
}

// -------------------------------------------------------------
// Profile Module
// -------------------------------------------------------------
async function loadProfile() {
  try {
    const res = await fetch('/customerportal/api/profile');
    const data = await res.json();
    if (data.success && data.profile) {
      const p = data.profile;
      document.getElementById('profileCompanyName').textContent = p.Company_Name || 'N/A';
      document.getElementById('profileCode').textContent = p.Code || 'N/A';
      document.getElementById('profileCustNr').textContent = p.Customer_Number || 'N/A';
      document.getElementById('profileEmail').textContent = p.Billing_Email || 'N/A';
      document.getElementById('profileContact').textContent = p.Billing_Contact_Name || 'N/A';
      document.getElementById('profileTel').textContent = p.Billing_Tel || 'N/A';
      document.getElementById('profileAddress').textContent = p.Billing_Physical_Address || 'N/A';
      document.getElementById('profileCountry').textContent = p.Billing_Country || 'N/A';

      document.getElementById('rateManday').textContent = formatCurrency(p.Man_Day_Rate);
      document.getElementById('rateKM').textContent = formatCurrency(p.Per_KM_Rate);
      document.getElementById('rateTravel').textContent = formatCurrency(p.Travel_Time_Rate_perHour);
      document.getElementById('rateHotel').textContent = formatCurrency(p.Hotel_perNight_Rate);
      document.getElementById('rateReport').textContent = formatCurrency(p.Report_Fee);
    }
  } catch (err) {
    console.error('Error loading profile:', err);
  }
}

// -------------------------------------------------------------
// Modal Utilities
// -------------------------------------------------------------
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('active');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}

function escapeHtml(text) {
  if (!text) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}
