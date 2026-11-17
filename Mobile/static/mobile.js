/* Approven Mobile - Client Application Logic */

// Global State
let currentView = 'view-dashboard';
let globalStats = {};
let allAuditsData = [];
let allCbData = [];
let allAuditorsData = [];
let drilldownCurrentRecords = [];
let availableAuditPrograms = [];
let chartInstances = {};

// Helper: Escape HTML
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Helper: Format Currency (€)
function formatCurrency(val) {
  if (val === null || val === undefined || isNaN(val)) return '€0.00';
  return '€' + Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Helper: Toast Notification
function showToast(msg, duration = 3000) {
  const toast = document.getElementById('mToast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// Helper: Format Date
function formatDate(dt) {
  if (!dt || dt === '-') return '-';
  try {
    const d = new Date(dt);
    if (isNaN(d.getTime())) return dt;
    return d.toISOString().split('T')[0];
  } catch {
    return dt;
  }
}

// Helper: Status Badges CSS class
function getStatusBadgeClass(status) {
  if (!status) return 'status-pending';
  const s = status.toLowerCase();
  if (s.includes('complete') || s === 'active') return 'status-complete';
  if (s.includes('confirm')) return 'status-confirmed';
  if (s.includes('pending') || s.includes('preparing')) return 'status-pending';
  if (s.includes('cancel') || s === 'inactive' || s.includes('decline')) return 'status-cancelled';
  return 'status-pending';
}

// --- Navigation Tabs ---
function switchView(targetViewId) {
  document.querySelectorAll('.m-view-section').forEach(sec => sec.classList.remove('active'));
  document.querySelectorAll('.m-nav-item').forEach(item => item.classList.remove('active'));

  const targetSection = document.getElementById(targetViewId);
  if (targetSection) targetSection.classList.add('active');

  const navItem = document.querySelector(`.m-nav-item[data-target="${targetViewId}"]`);
  if (navItem) navItem.classList.add('active');

  currentView = targetViewId;
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Load data for view if needed
  if (targetViewId === 'view-dashboard') {
    loadDashboardAnalytics();
  } else if (targetViewId === 'view-audits') {
    loadAuditsList();
  } else if (targetViewId === 'view-cbs') {
    loadCbList();
  } else if (targetViewId === 'view-auditors') {
    loadAuditorsList();
  } else if (targetViewId === 'view-more') {
    loadSyncStatus();
    loadDashboardStats();
  }
}

// --- Sync Data Implementation ---
async function triggerSync(buttonEl, labelEl, iconEl) {
  if (iconEl) iconEl.classList.add('spin');
  if (labelEl) labelEl.textContent = 'Syncing...';
  if (buttonEl) buttonEl.disabled = true;

  try {
    const res = await fetch('/api/sync-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'Database synchronized successfully!');
      await loadSyncStatus();
      await loadDashboardStats();
      if (document.getElementById('view-audits')?.classList.contains('active')) {
        loadAuditsList();
      }
      if (document.getElementById('view-cb')?.classList.contains('active')) {
        loadCbList();
      }
      if (document.getElementById('view-auditees')?.classList.contains('active')) {
        loadAuditeesList();
      }
      if (document.getElementById('view-auditors')?.classList.contains('active')) {
        loadAuditorsList();
      }
    } else {
      showToast(data.message || 'Sync failed.');
      await loadSyncStatus();
    }
  } catch (err) {
    showToast('Sync error: ' + err.message);
    await loadSyncStatus();
  } finally {
    if (iconEl) iconEl.classList.remove('spin');
    if (labelEl) labelEl.textContent = 'Sync';
    if (buttonEl) buttonEl.disabled = false;
  }
}

async function loadSyncStatus() {
  try {
    const res = await fetch('/api/sync-status');
    if (res.ok) {
      const data = await res.json();
      const lastSync = data.last_sync_timestamp || 'Never';
      const label = document.getElementById('mLastSyncHeader');
      if (label) label.textContent = lastSync;
      const moreTime = document.getElementById('mMoreSyncTime');
      if (moreTime) moreTime.textContent = lastSync;
      const moreStatus = document.getElementById('mMoreSyncStatus');
      if (moreStatus) {
        moreStatus.textContent = data.status || 'OK';
        moreStatus.style.color = (data.status === 'SUCCESS' || data.status === 'OK') ? 'var(--success)' : 'var(--danger)';
      }
    }
  } catch (err) {}
}

// --- Dashboard & Analytics ---
async function loadDashboardStats() {
  try {
    const res = await fetch('/api/dashboard-stats');
    if (res.ok) {
      const stats = await res.json();
      globalStats = stats;
      
      const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val !== undefined ? val : '-';
      };

      setEl('statAuditsCount', stats.audits_count || 0);
      setEl('statCbCount', stats.cb_count || 0);
      setEl('statAuditorsCount', stats.auditors_count || 0);
      setEl('statMoreAuditees', stats.auditees_count || 0);
      setEl('statMoreUsers', stats.users_count || 0);
    }
  } catch (err) {}
}

async function loadDashboardAnalytics() {
  const fromDate = document.getElementById('mDashFromDate')?.value || '';
  const toDate = document.getElementById('mDashToDate')?.value || '';

  let url = '/api/dashboard-analytics';
  const params = new URLSearchParams();
  if (fromDate) params.append('from_date', fromDate);
  if (toDate) params.append('to_date', toDate);
  if (params.toString()) url += `?${params.toString()}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();

    // Calculate total quoted value for KPI
    let totalQuotesSum = 0;
    if (data.tile3) {
      data.tile3.forEach(t => totalQuotesSum += (t.total_value || 0));
    }
    const quoteEl = document.getElementById('statQuotesTotal');
    if (quoteEl) quoteEl.textContent = formatCurrency(totalQuotesSum);

    renderChartTile1(data.tile1 || []);
    renderChartTile2(data.tile2 || []);
    renderChartTile3(data.tile3 || []);
    renderChartTile4(data.tile4 || []);
    renderChartTile5(data.tile5 || []);
    renderChartTile6(data.tile6 || []);
  } catch (err) {
    console.error('Analytics load error:', err);
  }
}

function destroyChart(id) {
  if (chartInstances[id]) {
    chartInstances[id].destroy();
    delete chartInstances[id];
  }
}

// --- Chart Click and Touch Interactions ---
function handleMobileChartClick(canvasId, chart, datasetIndex, index) {
  if (!chart || !chart.data || !chart.data.labels) return;

  const fromDate = document.getElementById('mDashFromDate')?.value || '';
  const toDate = document.getElementById('mDashToDate')?.value || '';
  let params = { from_date: fromDate, to_date: toDate };
  let modalTitle = 'Audit Workflows & Quotes';

  if (canvasId === 'mChartTile1') {
    const rawLabel = chart.data.labels[index] || '';
    const cbName = String(rawLabel).replace(/\s*\(\d+\)$/, '').trim();
    params.cb_name = cbName;
    modalTitle = `Audits for Certification Body: ${cbName}`;

  } else if (canvasId === 'mChartTile2') {
    const rawLabel = chart.data.labels[index] || '';
    const statusName = String(rawLabel).replace(/\s*\(\d+\)$/, '').trim();
    params.workflow_status = statusName;
    modalTitle = `Audits with Status: ${statusName}`;

  } else if (canvasId === 'mChartTile3') {
    const labelObj = chart.data.labels[index];
    const quoteStatus = Array.isArray(labelObj) ? labelObj[0] : String(labelObj);
    params.quote_status = quoteStatus;
    modalTitle = `Quotes with Status: ${quoteStatus}`;

  } else if (canvasId === 'mChartTile4') {
    const cbName = chart.data.labels[index];
    const datasetLabel = chart.data.datasets[datasetIndex]?.label || 'Accepted';
    params.cb_name = cbName;
    params.quote_status = datasetLabel;
    modalTitle = `Quotes for ${cbName} (${datasetLabel})`;

  } else if (canvasId === 'mChartTile5') {
    const auditorName = chart.data.labels[index];
    const datasetLabel = chart.data.datasets[datasetIndex]?.label || '';
    params.auditor_name = auditorName;
    if (datasetLabel) params.workflow_status = datasetLabel;
    modalTitle = `Audits for Auditor: ${auditorName} ${datasetLabel ? '(' + datasetLabel + ')' : ''}`;

  } else if (canvasId === 'mChartTile6') {
    const programName = chart.data.labels[index];
    params.audit_program = programName;
    modalTitle = `Audits for Program: ${programName}`;
  }

  openDrilldownModal(params, modalTitle);
}

function bindMobileChartInteractions(canvasId, getChartInstance) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  canvas.style.cursor = 'pointer';

  const processEvent = function(e) {
    const chart = getChartInstance();
    if (!chart) return;

    let points = [];
    try {
      points = chart.getElementsAtEventForMode(e, 'nearest', { intersect: true }, false);
      if (!points || points.length === 0) {
        points = chart.getElementsAtEventForMode(e, 'nearest', { intersect: false }, false);
      }
    } catch (err) {
      console.warn('Chart touch interaction error:', err);
    }

    if (points && points.length > 0) {
      handleMobileChartClick(canvasId, chart, points[0].datasetIndex, points[0].index);
    } else {
      const titles = {
        'mChartTile1': 'Audits per Certification Body',
        'mChartTile2': 'Audits by Status',
        'mChartTile3': 'Total Quote Values',
        'mChartTile4': 'Quotes per Certification Body',
        'mChartTile5': 'Audits per Auditor',
        'mChartTile6': 'Audits per Audit Program'
      };
      openDrilldownModal({}, titles[canvasId] || 'Audit Workflows & Quotes');
    }
  };

  canvas.onclick = function(e) {
    processEvent(e);
  };
}

// --- Custom Chart.js Plugins to Draw Counts on Columns, Bars & Pie Pieces ---

// 1. Horizontal Bar Counts (Tile 1 & Tile 5)
const mHorizontalBarCountsPlugin = {
  id: 'mHorizontalBarCounts',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      if (!meta.hidden) {
        meta.data.forEach((element, index) => {
          const val = dataset.data[index];
          if (val > 0) {
            ctx.save();
            ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
            ctx.textBaseline = 'middle';

            const barWidth = Math.abs(element.x - element.base);
            if (barWidth >= 20) {
              ctx.textAlign = 'right';
              ctx.fillStyle = dataset.backgroundColor === '#5AE3A7' ? '#001429' : '#5AE3A7';
              ctx.fillText(val, element.x - 6, element.y);
            } else {
              ctx.textAlign = 'left';
              ctx.fillStyle = '#001429';
              ctx.fillText(val, element.x + 6, element.y);
            }
            ctx.restore();
          }
        });
      }
    });
  }
};

// 2. Pie / Doughnut Slices Counts (Tile 2)
const mPieSliceCountsPlugin = {
  id: 'mPieSliceCounts',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      if (!meta.hidden) {
        meta.data.forEach((element, index) => {
          const val = dataset.data[index];
          if (val > 0) {
            const pos = element.tooltipPosition();
            if (pos && !isNaN(pos.x) && !isNaN(pos.y)) {
              ctx.save();
              ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';

              const text = String(val);
              const textWidth = ctx.measureText(text).width;

              // Dark rounded badge behind text for crisp contrast
              ctx.fillStyle = 'rgba(0, 20, 41, 0.85)';
              ctx.beginPath();
              if (ctx.roundRect) {
                ctx.roundRect(pos.x - textWidth / 2 - 5, pos.y - 9, textWidth + 10, 18, 5);
              } else {
                ctx.rect(pos.x - textWidth / 2 - 5, pos.y - 9, textWidth + 10, 18);
              }
              ctx.fill();

              ctx.fillStyle = '#5AE3A7';
              ctx.fillText(text, pos.x, pos.y);
              ctx.restore();
            }
          }
        });
      }
    });
  }
};

// 3. Vertical Columns & Stacked Bar Counts (Tile 3, Tile 4, Tile 6)
const mVerticalColumnCountsPlugin = {
  id: 'mVerticalColumnCounts',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      if (!meta.hidden) {
        meta.data.forEach((element, index) => {
          const val = dataset.data[index];
          if (val > 0) {
            ctx.save();
            ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const x = element.x;
            const segmentHeight = Math.abs(element.base - element.y);

            let text = String(val);
            if (dataset.quoteCounts && dataset.quoteCounts[index] !== undefined) {
              text = `${dataset.quoteCounts[index]}`;
            }

            if (segmentHeight >= 15) {
              ctx.fillStyle = (dataset.backgroundColor === '#5AE3A7' || dataset.backgroundColor === '#fde68a') ? '#001429' : '#ffffff';
              const y = (element.y + element.base) / 2;
              ctx.fillText(text, x, y);
            } else if (segmentHeight > 0) {
              ctx.fillStyle = '#001429';
              ctx.fillText(text, x, element.y - 7);
            }
            ctx.restore();
          }
        });
      }
    });
  }
};

// Chart Renderers (Optimized for Mobile Screens & Approven Theme)
function renderChartTile1(data) {
  destroyChart('mChartTile1');
  const ctx = document.getElementById('mChartTile1')?.getContext('2d');
  if (!ctx) return;

  const topData = data.slice(0, 8);
  const labels = topData.map(d => `${d.cb_name || 'Unassigned'} (${d.audit_count || 0})`);
  const counts = topData.map(d => d.audit_count || 0);

  chartInstances['mChartTile1'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Audits',
        data: counts,
        backgroundColor: '#001429',
        borderColor: '#5AE3A7',
        borderWidth: 1.5,
        borderRadius: 6
      }]
    },
    plugins: [mHorizontalBarCountsPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      onClick: (evt, activeElements) => {
        if (activeElements && activeElements.length > 0) {
          handleMobileChartClick('mChartTile1', chartInstances['mChartTile1'], activeElements[0].datasetIndex, activeElements[0].index);
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Audits: ${ctx.raw} (Tap to view details)`
          }
        }
      },
      scales: {
        x: { beginAtZero: true, grid: { display: false } },
        y: { ticks: { font: { size: 10 } } }
      }
    }
  });

  bindMobileChartInteractions('mChartTile1', () => chartInstances['mChartTile1']);
}

function renderChartTile2(data) {
  destroyChart('mChartTile2');
  const ctx = document.getElementById('mChartTile2')?.getContext('2d');
  if (!ctx) return;

  const targetOrder = ['Pending', 'Confirmed', 'Complete'];
  const statusColors = {
    'Pending': '#f59e0b',
    'Confirmed': '#0284c7',
    'Complete': '#5AE3A7'
  };

  const sortedData = targetOrder.map(st => {
    const item = data.find(d => d.Status === st);
    return { Status: st, audit_count: item ? item.audit_count : 0 };
  });

  const labels = sortedData.map(d => `${d.Status} (${d.audit_count})`);
  const counts = sortedData.map(d => d.audit_count);
  const colors = sortedData.map(d => statusColors[d.Status] || '#64748b');

  chartInstances['mChartTile2'] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: counts,
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: '#ffffff'
      }]
    },
    plugins: [mPieSliceCountsPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (evt, activeElements) => {
        if (activeElements && activeElements.length > 0) {
          handleMobileChartClick('mChartTile2', chartInstances['mChartTile2'], activeElements[0].datasetIndex, activeElements[0].index);
        }
      },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11, weight: 'bold' } } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: ${ctx.raw} audits (Tap to view)`
          }
        }
      },
      cutout: '65%'
    }
  });

  bindMobileChartInteractions('mChartTile2', () => chartInstances['mChartTile2']);
}

function renderChartTile3(data) {
  destroyChart('mChartTile3');
  const ctx = document.getElementById('mChartTile3')?.getContext('2d');
  if (!ctx) return;

  const labels = data.map(d => `${d.Quote_Status} (${d.quote_count || 0})`);
  const values = data.map(d => d.total_value || 0);
  const quoteCounts = data.map(d => d.quote_count || 0);

  chartInstances['mChartTile3'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Total Value (€)',
        data: values,
        quoteCounts: quoteCounts,
        backgroundColor: ['#f59e0b', '#0284c7', '#5AE3A7'],
        borderRadius: 6
      }]
    },
    plugins: [mVerticalColumnCountsPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (evt, activeElements) => {
        if (activeElements && activeElements.length > 0) {
          handleMobileChartClick('mChartTile3', chartInstances['mChartTile3'], activeElements[0].datasetIndex, activeElements[0].index);
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Value: ${formatCurrency(ctx.raw)} (${quoteCounts[ctx.dataIndex]} quotes)`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (v) => '€' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v),
            font: { size: 10 }
          }
        },
        x: { ticks: { font: { size: 10 } } }
      }
    }
  });

  bindMobileChartInteractions('mChartTile3', () => chartInstances['mChartTile3']);
}

function renderChartTile4(data) {
  destroyChart('mChartTile4');
  const ctx = document.getElementById('mChartTile4')?.getContext('2d');
  if (!ctx) return;

  const cbs = Array.from(new Set(data.map(d => d.cb_name))).slice(0, 6);
  const acceptedData = cbs.map(cb => {
    const item = data.find(d => d.cb_name === cb && d.Quote_Status === 'Accepted');
    return item ? item.quote_count : 0;
  });
  const declinedData = cbs.map(cb => {
    const item = data.find(d => d.cb_name === cb && d.Quote_Status === 'Declined');
    return item ? item.quote_count : 0;
  });

  chartInstances['mChartTile4'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: cbs,
      datasets: [
        { label: 'Accepted', data: acceptedData, backgroundColor: '#5AE3A7', borderRadius: 4 },
        { label: 'Declined', data: declinedData, backgroundColor: '#ef4444', borderRadius: 4 }
      ]
    },
    plugins: [mVerticalColumnCountsPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (evt, activeElements) => {
        if (activeElements && activeElements.length > 0) {
          handleMobileChartClick('mChartTile4', chartInstances['mChartTile4'], activeElements[0].datasetIndex, activeElements[0].index);
        }
      },
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10 } } }
      },
      scales: {
        x: { ticks: { font: { size: 9 } } },
        y: { beginAtZero: true, ticks: { font: { size: 9 }, precision: 0 } }
      }
    }
  });

  bindMobileChartInteractions('mChartTile4', () => chartInstances['mChartTile4']);
}

function renderChartTile5(data) {
  destroyChart('mChartTile5');
  const ctx = document.getElementById('mChartTile5')?.getContext('2d');
  if (!ctx) return;

  const auditors = Array.from(new Set(data.map(d => d.auditor_name))).filter(Boolean).slice(0, 8);
  const confirmedData = auditors.map(name => {
    const item = data.find(d => d.auditor_name === name && d.Status === 'Confirmed');
    return item ? item.audit_count : 0;
  });
  const completeData = auditors.map(name => {
    const item = data.find(d => d.auditor_name === name && d.Status === 'Complete');
    return item ? item.audit_count : 0;
  });

  chartInstances['mChartTile5'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: auditors,
      datasets: [
        { label: 'Confirmed', data: confirmedData, backgroundColor: '#0284c7', borderRadius: 4 },
        { label: 'Complete', data: completeData, backgroundColor: '#5AE3A7', borderRadius: 4 }
      ]
    },
    plugins: [mHorizontalBarCountsPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      onClick: (evt, activeElements) => {
        if (activeElements && activeElements.length > 0) {
          handleMobileChartClick('mChartTile5', chartInstances['mChartTile5'], activeElements[0].datasetIndex, activeElements[0].index);
        }
      },
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10 } } }
      },
      scales: {
        x: { stacked: true, beginAtZero: true },
        y: { stacked: true, ticks: { font: { size: 9 } } }
      }
    }
  });

  bindMobileChartInteractions('mChartTile5', () => chartInstances['mChartTile5']);
}

function renderChartTile6(data) {
  destroyChart('mChartTile6');
  const ctx = document.getElementById('mChartTile6')?.getContext('2d');
  if (!ctx) return;

  const programs = Array.from(new Set(data.map(d => d.audit_program))).slice(0, 8);
  const pendingCounts = programs.map(p => {
    const item = data.find(d => d.audit_program === p && d.Status === 'Pending');
    return item ? item.audit_count : 0;
  });
  const confirmedCounts = programs.map(p => {
    const item = data.find(d => d.audit_program === p && d.Status === 'Confirmed');
    return item ? item.audit_count : 0;
  });
  const completeCounts = programs.map(p => {
    const item = data.find(d => d.audit_program === p && d.Status === 'Complete');
    return item ? item.audit_count : 0;
  });

  chartInstances['mChartTile6'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: programs,
      datasets: [
        { label: 'Pending', data: pendingCounts, backgroundColor: '#f59e0b', borderRadius: 4 },
        { label: 'Confirmed', data: confirmedCounts, backgroundColor: '#0284c7', borderRadius: 4 },
        { label: 'Complete', data: completeCounts, backgroundColor: '#5AE3A7', borderRadius: 4 }
      ]
    },
    plugins: [mVerticalColumnCountsPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (evt, activeElements) => {
        if (activeElements && activeElements.length > 0) {
          handleMobileChartClick('mChartTile6', chartInstances['mChartTile6'], activeElements[0].datasetIndex, activeElements[0].index);
        }
      },
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10 } } }
      },
      scales: {
        x: {
          stacked: true,
          ticks: { font: { size: 9 } }
        },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: { font: { size: 9 }, precision: 0 }
        }
      }
    }
  });

  bindMobileChartInteractions('mChartTile6', () => chartInstances['mChartTile6']);
}

// --- Drilldown Bottom Sheet ---
async function openDrilldownModal(filters = {}, title = 'Audit Workflows') {
  const sheet = document.getElementById('mDrilldownSheet');
  const titleEl = document.getElementById('mDrilldownTitle');
  const listEl = document.getElementById('mDrilldownList');
  const countEl = document.getElementById('mDrilldownCount');

  if (titleEl) titleEl.textContent = title;
  if (listEl) {
    listEl.innerHTML = `
      <div class="m-empty-state">
        <div class="mobile-spinner" style="border-top-color: var(--primary); width: 28px; height: 28px; margin: 0 auto 0.75rem;"></div>
        <p>Loading records...</p>
      </div>`;
  }
  sheet.classList.add('open');

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v) params.append(k, v);
  }
  const fromDate = document.getElementById('mDashFromDate')?.value;
  const toDate = document.getElementById('mDashToDate')?.value;
  if (fromDate) params.append('from_date', fromDate);
  if (toDate) params.append('to_date', toDate);

  try {
    const res = await fetch(`/api/dashboard-drilldown?${params.toString()}`);
    if (res.ok) {
      const records = await res.json();
      drilldownCurrentRecords = records;
      renderDrilldownRecords(records);
    }
  } catch (err) {
    if (listEl) listEl.innerHTML = `<div class="m-empty-state"><p>Error loading records.</p></div>`;
  }
}

function renderDrilldownRecords(records) {
  const listEl = document.getElementById('mDrilldownList');
  const countEl = document.getElementById('mDrilldownCount');
  if (countEl) countEl.textContent = `Showing ${records.length} records`;

  if (!records || records.length === 0) {
    listEl.innerHTML = `<div class="m-empty-state"><p>No matching records found.</p></div>`;
    return;
  }

  listEl.innerHTML = records.map(r => `
    <div class="m-audit-card" onclick="showAuditDetails(${r.WFID})">
      <div class="m-card-top">
        <span class="m-wfid-pill">#${escapeHtml(r.WFID)}</span>
        <div class="m-badge-group">
          <span class="m-status-badge ${getStatusBadgeClass(r.Workflow_Status)}">${escapeHtml(r.Workflow_Status || 'Pending')}</span>
        </div>
      </div>
      <div class="m-card-main-title">${escapeHtml(r.CB_Name || 'Unassigned')}</div>
      <div class="m-card-subtitle-row">
        <span>🏢 ${escapeHtml(r.Auditee_Name || '-')}</span>
      </div>
      <div class="m-card-grid-info">
        <div class="m-info-item">
          <span class="m-info-k">Program</span>
          <span class="m-info-v">${escapeHtml(r.Audit_Program || '-')}</span>
        </div>
        <div class="m-info-item">
          <span class="m-info-k">Start Date</span>
          <span class="m-info-v">${escapeHtml(r.Audit_Start || '-')}</span>
        </div>
      </div>
      <div class="m-card-footer">
        <span class="m-auditor-names">👤 ${escapeHtml(r.Auditor_Names || 'Unassigned')}</span>
        <span class="m-quote-val">${formatCurrency(r.Quote_SubTotal)}</span>
      </div>
    </div>
  `).join('');
}

// --- Audits & Quotes Module ---
let currentAuditStatusFilter = 'active';

async function loadAuditsList() {
  const listEl = document.getElementById('mAuditsList');
  const countLabel = document.getElementById('mAuditsCountLabel');
  const q = document.getElementById('mAuditSearch')?.value || '';

  let url = `/api/audits-list?status_filter=${encodeURIComponent(currentAuditStatusFilter)}`;
  if (q.trim()) url += `&q=${encodeURIComponent(q.trim())}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const audits = await res.json();
    allAuditsData = audits;

    if (countLabel) countLabel.textContent = `Showing ${audits.length} audits`;
    renderAuditsCards(audits);

    // Update count badges
    const activeCount = audits.filter(a => a.Workflow_Status !== 'Complete' && a.Workflow_Status !== 'Cancelled').length;
    const activeChipCount = document.getElementById('countAuditActive');
    const allChipCount = document.getElementById('countAuditAll');
    if (activeChipCount) activeChipCount.textContent = activeCount;
    if (allChipCount) allChipCount.textContent = audits.length;
  } catch (err) {
    if (listEl) listEl.innerHTML = `<div class="m-empty-state"><p>Error loading audits.</p></div>`;
  }
}

function renderAuditsCards(audits) {
  const listEl = document.getElementById('mAuditsList');
  if (!listEl) return;

  if (!audits || audits.length === 0) {
    listEl.innerHTML = `
      <div class="m-empty-state">
        <svg class="m-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <p>No audits matching your filter.</p>
      </div>`;
    return;
  }

  listEl.innerHTML = audits.map(a => `
    <div class="m-audit-card" onclick="showAuditDetails(${a.WFID})">
      <div class="m-card-top">
        <div style="display: flex; align-items: center; gap: 0.4rem;">
          <span class="m-wfid-pill">#${escapeHtml(a.WFID)}</span>
          ${a.Project_Nr ? `<span style="font-size: 0.72rem; color: var(--text-muted);">${escapeHtml(a.Project_Nr)}</span>` : ''}
        </div>
        <div class="m-badge-group">
          <span class="m-status-badge ${getStatusBadgeClass(a.Workflow_Status)}">${escapeHtml(a.Workflow_Status || 'Pending')}</span>
          ${a.Quote_Status ? `<span class="m-status-badge ${getStatusBadgeClass(a.Quote_Status)}">${escapeHtml(a.Quote_Status)}</span>` : ''}
        </div>
      </div>

      <div class="m-card-main-title">${escapeHtml(a.CB_Name || 'Unassigned')}</div>
      <div class="m-card-subtitle-row">
        <span>🏢 <strong>${escapeHtml(a.Auditee_Name || '-')}</strong></span>
        ${a.Site_Country && a.Site_Country !== '-' ? `<span>&bull; 📍 ${escapeHtml(a.Site_Country)}</span>` : ''}
      </div>

      <div class="m-card-grid-info">
        <div class="m-info-item">
          <span class="m-info-k">Program &amp; Type</span>
          <span class="m-info-v">${escapeHtml(a.Audit_Program || '-')} ${a.Audit_Type ? `(${escapeHtml(a.Audit_Type)})` : ''}</span>
        </div>
        <div class="m-info-item">
          <span class="m-info-k">Dates</span>
          <span class="m-info-v">${escapeHtml(a.Audit_Start || '-')} &rarr; ${escapeHtml(a.Audit_End || '-')}</span>
        </div>
        <div class="m-info-item">
          <span class="m-info-k">Mandays</span>
          <span class="m-info-v">${a.Total_Mandays ? a.Total_Mandays + ' days' : '-'}</span>
        </div>
        <div class="m-info-item">
          <span class="m-info-k">Invoiced</span>
          <span class="m-info-v">${a.Invoiced ? '✅ Yes' : '❌ No'}</span>
        </div>
      </div>

      <div class="m-card-footer">
        <span class="m-auditor-names">👤 ${escapeHtml(a.Auditor_Names || 'Unassigned')}</span>
        <span class="m-quote-val">${formatCurrency(a.Quote_SubTotal)}</span>
      </div>
    </div>
  `).join('');
}

// Show Audit Details in Mobile Bottom Sheet
function showAuditDetails(wfid) {
  const audit = allAuditsData.find(a => a.WFID === wfid) || drilldownCurrentRecords.find(a => a.WFID === wfid);
  if (!audit) return;

  const sheet = document.getElementById('mAuditDetailSheet');
  const wfidLabel = document.getElementById('mDetailWfid');
  const statusLabel = document.getElementById('mDetailStatus');
  const content = document.getElementById('mAuditDetailContent');

  if (wfidLabel) wfidLabel.textContent = `WFID #${audit.WFID}`;
  if (statusLabel) {
    statusLabel.textContent = audit.Workflow_Status || 'Pending';
    statusLabel.className = `m-status-badge ${getStatusBadgeClass(audit.Workflow_Status)}`;
  }

  content.innerHTML = `
    <div class="m-metric-card" style="background: var(--bg-body);">
      <span class="m-metric-label">Certification Body</span>
      <strong style="font-size: 1.05rem; color: var(--primary-dark);">${escapeHtml(audit.CB_Name || 'Unassigned')}</strong>
      <span style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.25rem;">Auditee: <strong>${escapeHtml(audit.Auditee_Name || '-')}</strong></span>
      <span style="font-size: 0.78rem; color: var(--text-muted);">Site Location: ${escapeHtml(audit.Site_Location || audit.Site_Name || '-')}</span>
    </div>

    <div class="m-card-grid-info">
      <div class="m-info-item">
        <span class="m-info-k">Audit Program</span>
        <span class="m-info-v">${escapeHtml(audit.Audit_Program || '-')}</span>
      </div>
      <div class="m-info-item">
        <span class="m-info-k">Audit Type</span>
        <span class="m-info-v">${escapeHtml(audit.Audit_Type || '-')}</span>
      </div>
      <div class="m-info-item">
        <span class="m-info-k">Start Date</span>
        <span class="m-info-v">${escapeHtml(audit.Audit_Start || '-')}</span>
      </div>
      <div class="m-info-item">
        <span class="m-info-k">End Date</span>
        <span class="m-info-v">${escapeHtml(audit.Audit_End || '-')}</span>
      </div>
      <div class="m-info-item">
        <span class="m-info-k">Total Mandays</span>
        <span class="m-info-v">${audit.Total_Mandays || '-'}</span>
      </div>
      <div class="m-info-item">
        <span class="m-info-k">Auditors Required</span>
        <span class="m-info-v">${audit.AuditorsRequired || 1}</span>
      </div>
    </div>

    <div class="m-metric-card" style="border-color: #bfdbfe; background: var(--accent-soft);">
      <span class="m-metric-label">Quote &amp; Financials</span>
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-top: 0.25rem;">
        <span style="font-size: 0.85rem; color: var(--text-secondary);">Quote Status: <strong>${escapeHtml(audit.Quote_Status || '-')}</strong></span>
        <span style="font-size: 1.25rem; font-weight: 800; color: var(--primary-dark);">${formatCurrency(audit.Quote_SubTotal)}</span>
      </div>
      <div style="margin-top: 0.5rem; font-size: 0.8rem; border-top: 1px solid #dbeafe; padding-top: 0.4rem; display: flex; justify-content: space-between;">
        <span>Invoiced: <strong>${audit.Invoiced ? 'Yes (' + escapeHtml(audit.Inv_Number || '') + ')' : 'No'}</strong></span>
        ${audit.Inv_Amount ? `<span>Inv Amount: <strong>${formatCurrency(audit.Inv_Amount)}</strong></span>` : ''}
      </div>
    </div>

    <div class="m-form-group">
      <label class="m-form-label">Assigned Auditors</label>
      <div style="background: var(--bg-body); padding: 0.65rem 0.85rem; border-radius: var(--radius-md); font-weight: 600; font-size: 0.88rem;">
        👤 ${escapeHtml(audit.Auditor_Names || 'No auditors assigned')}
      </div>
    </div>
  `;

  sheet.classList.add('open');
}

// --- Certification Bodies Module ---
let currentCbStatusFilter = 'Active';

async function loadCbList() {
  const listEl = document.getElementById('mCbList');
  const countLabel = document.getElementById('mCbCountLabel');
  const q = document.getElementById('mCbSearch')?.value || '';

  let url = `/api/certification-bodies?status_filter=${encodeURIComponent(currentCbStatusFilter)}`;
  if (q.trim()) url += `&q=${encodeURIComponent(q.trim())}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const cbs = await res.json();
    allCbData = cbs;

    if (countLabel) countLabel.textContent = `Showing ${cbs.length} certification bodies`;
    renderCbCards(cbs);
  } catch (err) {
    if (listEl) listEl.innerHTML = `<div class="m-empty-state"><p>Error loading certification bodies.</p></div>`;
  }
}

function renderCbCards(cbs) {
  const listEl = document.getElementById('mCbList');
  if (!listEl) return;

  if (!cbs || cbs.length === 0) {
    listEl.innerHTML = `<div class="m-empty-state"><p>No certification bodies found.</p></div>`;
    return;
  }

  listEl.innerHTML = cbs.map(cb => `
    <div class="m-cb-card">
      <div class="m-card-top">
        <div style="display: flex; align-items: center; gap: 0.4rem;">
          <span class="m-wfid-pill">${escapeHtml(cb.Code || '#' + cb.ID)}</span>
          ${cb.Customer_Number ? `<span style="font-size: 0.72rem; color: var(--text-muted);">${escapeHtml(cb.Customer_Number)}</span>` : ''}
        </div>
        <span class="m-status-badge ${cb.Status === 'Active' ? 'status-active' : 'status-inactive'}">${escapeHtml(cb.Status || 'Active')}</span>
      </div>

      <div class="m-card-main-title">${escapeHtml(cb.Company_Name)}</div>
      
      ${cb.Billing_Physical_Address || cb.Billing_Country ? `
        <div class="m-card-subtitle-row">
          <span>📍 ${escapeHtml(cb.Billing_Physical_Address || '')} ${cb.Billing_Country ? '(' + escapeHtml(cb.Billing_Country) + ')' : ''}</span>
        </div>
      ` : ''}

      ${cb.Billing_Email ? `
        <div class="m-card-subtitle-row" style="margin-top: 0.25rem;">
          <a href="mailto:${escapeHtml(cb.Billing_Email)}" style="color: var(--accent); text-decoration: none; font-size: 0.8rem; display: flex; align-items: center; gap: 0.35rem;">✉️ ${escapeHtml(cb.Billing_Email)}</a>
        </div>
      ` : ''}

      <div class="m-card-actions-row">
        <button type="button" class="m-btn-card-action primary" onclick="openEditCbModal(${cb.ID})">
          ✏️ Edit / Details
        </button>
      </div>
    </div>
  `).join('');
}

// Open CB Modal for Add / Edit
let cbCurrentContacts = [];
let mCbIsDirty = false;

function attachMobileCbDirtyTracker() {
  const form = document.getElementById('mCbForm');
  if (!form || form.dataset.dirtyAttached) return;
  form.dataset.dirtyAttached = 'true';
  form.querySelectorAll('input, select, textarea').forEach(elem => {
    elem.addEventListener('input', () => { mCbIsDirty = true; });
    elem.addEventListener('change', () => { mCbIsDirty = true; });
  });
}

async function openEditCbModal(cbId = null) {
  const sheet = document.getElementById('mCbModalSheet');
  const titleEl = document.getElementById('mCbModalTitle');
  const form = document.getElementById('mCbForm');
  form.reset();
  cbCurrentContacts = [];
  attachMobileCbDirtyTracker();

  // Reset tab to General
  switchModalTab('mCbModalSheet', 'mTabCbGeneral');

  if (cbId) {
    titleEl.textContent = 'Edit Certification Body';
    document.getElementById('m_cb_id').value = cbId;

    try {
      const res = await fetch(`/api/certification-bodies/${cbId}`);
      if (res.ok) {
        const cb = await res.json();
        document.getElementById('m_cb_Company_Name').value = cb.Company_Name || '';
        document.getElementById('m_cb_Customer_Number').value = cb.Customer_Number || '';
        document.getElementById('m_cb_Code').value = cb.Code || '';
        document.getElementById('m_cb_Status').value = cb.Status || 'Active';
        document.getElementById('m_cb_Billing_Physical_Address').value = cb.Billing_Physical_Address || '';
        document.getElementById('m_cb_Billing_Country').value = cb.Billing_Country || '';
        document.getElementById('m_cb_Billing_Contact_Name').value = cb.Billing_Contact_Name || '';
        document.getElementById('m_cb_Billing_Email').value = cb.Billing_Email || '';
        document.getElementById('m_cb_Billing_Tel').value = cb.Billing_Tel || '';

        document.getElementById('m_cb_Man_Day_Rate').value = cb.Man_Day_Rate || '';
        document.getElementById('m_cb_Report_Fee').value = cb.Report_Fee || '';
        document.getElementById('m_cb_Per_KM_Rate').value = cb.Per_KM_Rate || '';
        document.getElementById('m_cb_Travel_Time_Rate_perHour').value = cb.Travel_Time_Rate_perHour || '';
        document.getElementById('m_cb_Hotel_perNight_Rate').value = cb.Hotel_perNight_Rate || '';
        document.getElementById('m_cb_Quote_Terms').value = cb.Quote_Terms || '';
        document.getElementById('m_cb_Comments').value = cb.Comments || '';

        cbCurrentContacts = cb.contacts || [];
        renderCbContactsList();
      }
    } catch (err) {
      showToast('Error loading CB detail');
    }
  } else {
    titleEl.textContent = 'New Certification Body';
    document.getElementById('m_cb_id').value = '';
    renderCbContactsList();
  }

  mCbIsDirty = false;
  sheet.classList.add('open');
}

function renderCbContactsList() {
  const container = document.getElementById('mCbContactsContainer');
  const countBadge = document.getElementById('mCbContactCount');
  if (countBadge) countBadge.textContent = cbCurrentContacts.length;

  if (!cbCurrentContacts || cbCurrentContacts.length === 0) {
    container.innerHTML = `<div class="m-empty-state" style="padding: 1.5rem;"><p>No contacts linked yet. Tap "+ Add Contact" above.</p></div>`;
    return;
  }

  container.innerHTML = cbCurrentContacts.map((c, idx) => `
    <div class="m-metric-card" style="background: var(--bg-body); position: relative;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <strong style="font-size: 0.95rem;">${escapeHtml(c.First_Name || '')} ${escapeHtml(c.Last_Name || '')}</strong>
          ${c.Position ? `<div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(c.Position)}</div>` : ''}
        </div>
        <button type="button" onclick="removeCbContact(${idx})" style="background: transparent; border: none; color: var(--danger); font-size: 1.1rem; cursor: pointer;">&times;</button>
      </div>

      <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
        ${c.Mobile || c.Tel ? `<a href="tel:${escapeHtml(c.Mobile || c.Tel)}" class="m-btn-contact call">📞 Call</a>` : ''}
        ${c.Email ? `<a href="mailto:${escapeHtml(c.Email)}" class="m-btn-contact email">✉️ Email</a>` : ''}
      </div>
    </div>
  `).join('');
}

function removeCbContact(idx) {
  cbCurrentContacts.splice(idx, 1);
  mCbIsDirty = true;
  renderCbContactsList();
}

function addCbContactPrompt() {
  const fName = prompt('Contact First Name:');
  if (!fName) return;
  const lName = prompt('Contact Last Name:') || '';
  const pos = prompt('Position / Title:') || '';
  const email = prompt('Email Address:') || '';
  const phone = prompt('Mobile / Phone Number:') || '';

  cbCurrentContacts.push({
    First_Name: fName,
    Last_Name: lName,
    Position: pos,
    Email: email,
    Mobile: phone,
    Status: 'Active'
  });
  mCbIsDirty = true;
  renderCbContactsList();
}

async function attemptCloseMobileCbModal() {
  if (mCbIsDirty) {
    const companyName = document.getElementById('m_cb_Company_Name')?.value?.trim();
    if (companyName) {
      await saveCb();
      return;
    }
  }
  document.getElementById('mCbModalSheet')?.classList.remove('open');
  mCbIsDirty = false;
}

// Save Certification Body
async function saveCb() {
  const cbId = document.getElementById('m_cb_id').value;
  const companyName = document.getElementById('m_cb_Company_Name').value;
  if (!companyName.trim()) {
    showToast('Company Name is required.');
    return;
  }

  const payload = {
    Company_Name: companyName.trim(),
    Customer_Number: document.getElementById('m_cb_Customer_Number').value || null,
    Code: document.getElementById('m_cb_Code').value || null,
    Status: document.getElementById('m_cb_Status').value || 'Active',
    Billing_Physical_Address: document.getElementById('m_cb_Billing_Physical_Address').value || null,
    Billing_Country: document.getElementById('m_cb_Billing_Country').value || null,
    Billing_Contact_Name: document.getElementById('m_cb_Billing_Contact_Name').value || null,
    Billing_Email: document.getElementById('m_cb_Billing_Email').value || null,
    Billing_Tel: document.getElementById('m_cb_Billing_Tel').value || null,
    Man_Day_Rate: parseFloat(document.getElementById('m_cb_Man_Day_Rate').value) || null,
    Report_Fee: parseFloat(document.getElementById('m_cb_Report_Fee').value) || null,
    Per_KM_Rate: parseFloat(document.getElementById('m_cb_Per_KM_Rate').value) || null,
    Travel_Time_Rate_perHour: parseFloat(document.getElementById('m_cb_Travel_Time_Rate_perHour').value) || null,
    Hotel_perNight_Rate: parseFloat(document.getElementById('m_cb_Hotel_perNight_Rate').value) || null,
    Quote_Terms: document.getElementById('m_cb_Quote_Terms').value || null,
    Comments: document.getElementById('m_cb_Comments').value || null,
    contacts: cbCurrentContacts
  };

  const url = cbId ? `/api/certification-bodies/${cbId}` : '/api/certification-bodies';
  const method = cbId ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      showToast(cbId ? 'CB updated successfully' : 'CB created successfully');
      mCbIsDirty = false;
      document.getElementById('mCbModalSheet').classList.remove('open');
      loadCbList();
    } else {
      showToast('Error saving Certification Body');
    }
  } catch (err) {
    showToast('Network error saving CB');
  }
}

// --- Auditors Module ---
let currentAuditorStatusFilter = 'Active';

async function loadAuditorsList() {
  const listEl = document.getElementById('mAuditorList');
  const countLabel = document.getElementById('mAuditorCountLabel');
  const q = (document.getElementById('mAuditorSearch')?.value || '').toLowerCase().trim();

  try {
    const res = await fetch('/api/auditors');
    if (!res.ok) return;
    let auditors = await res.json();
    allAuditorsData = auditors;

    if (currentAuditorStatusFilter !== 'all') {
      auditors = auditors.filter(a => (a.Status || 'Active') === currentAuditorStatusFilter);
    }

    if (q) {
      auditors = auditors.filter(a => {
        const fullStr = `${a.First_Name || ''} ${a.Last_Name || ''} ${a.Email || ''} ${a.Residence_City || ''} ${a.Residence_Country || ''} ${a.APSCA_Nr || ''}`.toLowerCase();
        return fullStr.includes(q);
      });
    }

    if (countLabel) countLabel.textContent = `Showing ${auditors.length} auditors`;
    renderAuditorCards(auditors);
  } catch (err) {
    if (listEl) listEl.innerHTML = `<div class="m-empty-state"><p>Error loading auditors directory.</p></div>`;
  }
}

function renderAuditorCards(auditors) {
  const listEl = document.getElementById('mAuditorList');
  if (!listEl) return;

  if (!auditors || auditors.length === 0) {
    listEl.innerHTML = `<div class="m-empty-state"><p>No auditors found matching criteria.</p></div>`;
    return;
  }

  listEl.innerHTML = auditors.map(aud => {
    const initials = `${(aud.First_Name || '')[0] || ''}${(aud.Last_Name || '')[0] || ''}`.toUpperCase();
    return `
      <div class="m-auditor-card">
        <div class="m-auditor-header-box">
          <div class="m-auditor-avatar">${initials || 'A'}</div>
          <div class="m-auditor-title-box">
            <div class="m-auditor-name">
              <span>${escapeHtml(aud.First_Name || '')} ${escapeHtml(aud.Last_Name || '')}</span>
              ${aud.Lead_Auditor ? '<span class="m-lead-star" title="Lead Auditor">⭐</span>' : ''}
            </div>
            <div style="display: flex; gap: 0.35rem; align-items: center; margin-top: 0.15rem; flex-wrap: wrap;">
              ${aud.APSCA_Nr ? `<span class="m-wfid-pill">APSCA #${escapeHtml(aud.APSCA_Nr)}</span>` : ''}
              <span class="m-status-badge ${aud.Status === 'Active' ? 'status-active' : 'status-inactive'}">${escapeHtml(aud.Status || 'Active')}</span>
            </div>
          </div>
        </div>

        ${aud.Residence_City || aud.Residence_Country || aud.Employment_Type ? `
          <div class="m-card-subtitle-row">
            <span>📍 ${escapeHtml(aud.Residence_City || '')} ${aud.Residence_Country ? '(' + escapeHtml(aud.Residence_Country) + ')' : ''}</span>
            ${aud.Employment_Type ? `<span>&bull; 💼 ${escapeHtml(aud.Employment_Type)}</span>` : ''}
          </div>
        ` : ''}

        <div class="m-contact-actions">
          ${aud.Mobile_Nr ? `<a href="tel:${escapeHtml(aud.Mobile_Nr)}" class="m-btn-contact call">📞 Call</a>` : ''}
          ${aud.Email ? `<a href="mailto:${escapeHtml(aud.Email)}" class="m-btn-contact email">✉️ Email</a>` : ''}
          <button type="button" class="m-btn-card-action primary" style="flex: 1.2;" onclick="openEditAuditorModal(${aud.AuditorID})">
            ✏️ Profile
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Open Auditor Modal
let auditorOnboardedCbs = [];
let auditorPrograms = [];

async function openEditAuditorModal(auditorId = null) {
  const sheet = document.getElementById('mAuditorModalSheet');
  const titleEl = document.getElementById('mAuditorModalTitle');
  const form = document.getElementById('mAuditorForm');
  form.reset();
  auditorOnboardedCbs = [];
  auditorPrograms = [];

  switchModalTab('mAuditorModalSheet', 'mTabAuditorPersonal');

  // Load all CB options into checkbox list
  await populateAuditorCbCheckboxes();

  if (auditorId) {
    titleEl.textContent = 'Edit Auditor';
    document.getElementById('m_auditor_id').value = auditorId;

    try {
      const res = await fetch(`/api/auditors/${auditorId}`);
      if (res.ok) {
        const aud = await res.json();
        document.getElementById('m_aud_First_Name').value = aud.First_Name || '';
        document.getElementById('m_aud_Last_Name').value = aud.Last_Name || '';
        document.getElementById('m_aud_Status').value = aud.Status || 'Active';
        document.getElementById('m_aud_Gender').value = aud.Gender || '';
        document.getElementById('m_aud_Email').value = aud.Email || '';
        document.getElementById('m_aud_Mobile_Nr').value = aud.Mobile_Nr || '';
        document.getElementById('m_aud_APSCA_Nr').value = aud.APSCA_Nr || '';
        document.getElementById('m_aud_Employment_Type').value = aud.Employment_Type || '';
        document.getElementById('m_aud_Residence_City').value = aud.Residence_City || '';
        document.getElementById('m_aud_Residence_Country').value = aud.Residence_Country || '';
        document.getElementById('m_aud_Lead_Auditor').checked = !!aud.Lead_Auditor;
        document.getElementById('m_aud_Internal_Onboarding_Complete').checked = !!aud.Internal_Onboarding_Complete;

        // Check onboarded CBs
        const checkedCbIds = new Set((aud.cbs_onboarded || []).map(c => c.CB));
        document.querySelectorAll('.m-aud-cb-check').forEach(chk => {
          chk.checked = checkedCbIds.has(parseInt(chk.value));
        });

        auditorPrograms = aud.auditor_programs || [];
        renderAuditorProgramsList();
      }
    } catch (err) {
      showToast('Error loading auditor details');
    }
  } else {
    titleEl.textContent = 'New Auditor';
    document.getElementById('m_auditor_id').value = '';
    renderAuditorProgramsList();
  }

  sheet.classList.add('open');
}

async function populateAuditorCbCheckboxes() {
  const container = document.getElementById('mAuditorCbCheckboxList');
  if (!container) return;

  if (allCbData.length === 0) {
    try {
      const res = await fetch('/api/certification-bodies?status_filter=Active');
      if (res.ok) allCbData = await res.json();
    } catch (err) {}
  }

  container.innerHTML = allCbData.map(cb => `
    <label class="m-checkbox-label" style="background: var(--bg-body); padding: 0.5rem 0.75rem; border-radius: var(--radius-sm);">
      <input type="checkbox" class="m-aud-cb-check" value="${cb.ID}">
      <span>${escapeHtml(cb.Company_Name)}</span>
    </label>
  `).join('');
}

function renderAuditorProgramsList() {
  const container = document.getElementById('mAuditorProgramsContainer');
  if (!container) return;

  if (!auditorPrograms || auditorPrograms.length === 0) {
    container.innerHTML = `<div class="m-empty-state" style="padding: 1.5rem;"><p>No programs assigned. Tap "⚡ Seed All" to populate.</p></div>`;
    return;
  }

  container.innerHTML = auditorPrograms.map((p, idx) => `
    <div class="m-metric-card" style="background: var(--bg-body);">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <strong>${escapeHtml(p.Program || '-')}</strong>
        <span class="m-status-badge ${p.Status === 'Compliant' ? 'status-complete' : 'status-pending'}">${escapeHtml(p.Status || 'Compliant')}</span>
      </div>
      <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">
        CB: ${escapeHtml(p.Company_Name || 'CB #' + p.CertificationBody)}
      </div>
      ${p.Accred_Expiry ? `<div style="font-size: 0.72rem; color: var(--text-secondary);">Expiry: ${escapeHtml(p.Accred_Expiry)}</div>` : ''}
    </div>
  `).join('');
}

// Seed Programs for Auditor
async function seedAuditorPrograms() {
  const auditorId = document.getElementById('m_auditor_id').value;
  if (!auditorId) {
    showToast('Please save the auditor first before seeding programs.');
    return;
  }

  try {
    const res = await fetch(`/api/auditors/${auditorId}/seed-programs`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      showToast(`Added ${data.added_count || 0} programs.`);
      // Reload auditor
      const audRes = await fetch(`/api/auditors/${auditorId}`);
      if (audRes.ok) {
        const aud = await audRes.json();
        auditorPrograms = aud.auditor_programs || [];
        renderAuditorProgramsList();
      }
    }
  } catch (err) {
    showToast('Error seeding programs.');
  }
}

// Save Auditor
async function saveAuditor() {
  const auditorId = document.getElementById('m_auditor_id').value;
  const fName = document.getElementById('m_aud_First_Name').value;
  const lName = document.getElementById('m_aud_Last_Name').value;

  if (!fName.trim() || !lName.trim()) {
    showToast('First Name and Last Name are required.');
    return;
  }

  // Collect checked CBs
  const selectedCbs = [];
  document.querySelectorAll('.m-aud-cb-check:checked').forEach(chk => {
    selectedCbs.push({ CB: parseInt(chk.value), Status: 'Onboarded' });
  });

  const payload = {
    First_Name: fName.trim(),
    Last_Name: lName.trim(),
    Status: document.getElementById('m_aud_Status').value || 'Active',
    Gender: document.getElementById('m_aud_Gender').value || null,
    Email: document.getElementById('m_aud_Email').value || null,
    Mobile_Nr: document.getElementById('m_aud_Mobile_Nr').value || null,
    APSCA_Nr: document.getElementById('m_aud_APSCA_Nr').value || null,
    Employment_Type: document.getElementById('m_aud_Employment_Type').value || null,
    Residence_City: document.getElementById('m_aud_Residence_City').value || null,
    Residence_Country: document.getElementById('m_aud_Residence_Country').value || null,
    Lead_Auditor: document.getElementById('m_aud_Lead_Auditor').checked,
    Internal_Onboarding_Complete: document.getElementById('m_aud_Internal_Onboarding_Complete').checked,
    cbs_onboarded: selectedCbs,
    auditor_programs: auditorPrograms
  };

  const url = auditorId ? `/api/auditors/${auditorId}` : '/api/auditors';
  const method = auditorId ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      showToast(auditorId ? 'Auditor updated successfully' : 'Auditor created successfully');
      document.getElementById('mAuditorModalSheet').classList.remove('open');
      loadAuditorsList();
    } else {
      showToast('Error saving Auditor');
    }
  } catch (err) {
    showToast('Network error saving Auditor');
  }
}

// Modal Tab Switcher Helper
function switchModalTab(sheetId, targetTabId) {
  const sheet = document.getElementById(sheetId);
  if (!sheet) return;

  sheet.querySelectorAll('.m-modal-tab-btn').forEach(b => b.classList.remove('active'));
  sheet.querySelectorAll('.m-tab-pane').forEach(p => {
    p.classList.remove('active');
    p.style.display = 'none';
  });

  const btn = sheet.querySelector(`.m-modal-tab-btn[data-tab="${targetTabId}"]`);
  if (btn) btn.classList.add('active');

  const pane = document.getElementById(targetTabId);
  if (pane) {
    pane.classList.add('active');
    pane.style.display = 'block';
  }
}

// Export Table Data to Excel (.xlsx)
function exportToExcel(records, filename = 'approven_export.xlsx') {
  if (!window.XLSX) {
    showToast('Excel exporter library loading...');
    return;
  }
  if (!records || records.length === 0) {
    showToast('No records to export');
    return;
  }

  const ws = XLSX.utils.json_to_sheet(records);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Records');
  XLSX.writeFile(wb, filename);
  showToast('Excel file downloaded!');
}

// ============================================================================
// INITIALIZATION & EVENT LISTENERS
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  
  // 1. Bottom Navigation Click
  document.querySelectorAll('.m-nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const target = item.getAttribute('data-target');
      if (target) switchView(target);
    });
  });

  // 2. Profile Avatar Toggle
  const avatarBtn = document.getElementById('mBtnAvatar');
  const profileDrawer = document.getElementById('mProfileDrawer');
  avatarBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    profileDrawer?.classList.toggle('open');
  });
  document.addEventListener('click', () => profileDrawer?.classList.remove('open'));

  // 3. Header Sync Button & More Page Sync Button
  const btnSync = document.getElementById('mBtnSync');
  btnSync?.addEventListener('click', () => {
    triggerSync(btnSync, document.getElementById('mSyncLabel'), document.getElementById('mSyncIcon'));
  });

  const btnTriggerSync = document.getElementById('mBtnTriggerSync');
  btnTriggerSync?.addEventListener('click', () => {
    const text = document.getElementById('mBtnSyncText');
    const spin = document.getElementById('mBtnSyncSpinner');
    text.style.display = 'none';
    spin.style.display = 'inline-block';
    btnTriggerSync.disabled = true;

    triggerSync(btnSync, document.getElementById('mSyncLabel'), document.getElementById('mSyncIcon'))
      .finally(() => {
        text.style.display = 'inline-block';
        spin.style.display = 'none';
        btnTriggerSync.disabled = false;
      });
  });

  // 4. Dashboard Date Filter Pills
  document.querySelectorAll('#dashPills .m-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#dashPills .m-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');

      const range = pill.getAttribute('data-range');
      const customRow = document.getElementById('customDateRow');
      const fromInput = document.getElementById('mDashFromDate');
      const toInput = document.getElementById('mDashToDate');

      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const toStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

      if (range === 'custom') {
        customRow.style.display = 'flex';
        return;
      } else {
        customRow.style.display = 'none';
      }

      if (range === 'all') {
        fromInput.value = '';
        toInput.value = '';
      } else if (range === 'month') {
        fromInput.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
        toInput.value = toStr;
      } else if (range === '30d') {
        const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        fromInput.value = `${d30.getFullYear()}-${pad(d30.getMonth() + 1)}-${pad(d30.getDate())}`;
        toInput.value = toStr;
      } else if (range === 'year') {
        fromInput.value = `${now.getFullYear()}-01-01`;
        toInput.value = toStr;
      }

      loadDashboardAnalytics();
    });
  });

  document.getElementById('mBtnApplyDashFilter')?.addEventListener('click', loadDashboardAnalytics);

  // 5. Drilldown Modal Listeners
  document.getElementById('mBtnCloseDrilldown')?.addEventListener('click', () => {
    document.getElementById('mDrilldownSheet')?.classList.remove('open');
  });

  document.getElementById('mDrilldownSearch')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) {
      renderDrilldownRecords(drilldownCurrentRecords);
      return;
    }
    const filtered = drilldownCurrentRecords.filter(r => {
      const s = `${r.WFID} ${r.CB_Name || ''} ${r.Auditee_Name || ''} ${r.Audit_Program || ''} ${r.Workflow_Status || ''} ${r.Auditor_Names || ''}`.toLowerCase();
      return s.includes(q);
    });
    renderDrilldownRecords(filtered);
  });

  document.getElementById('mBtnExportDrilldown')?.addEventListener('click', () => {
    exportToExcel(drilldownCurrentRecords, 'approven_drilldown.xlsx');
  });

  // 6. Audit Detail Sheet Listeners
  document.getElementById('mBtnCloseAuditDetail')?.addEventListener('click', () => {
    document.getElementById('mAuditDetailSheet')?.classList.remove('open');
  });
  document.getElementById('mBtnCloseAuditDetailFooter')?.addEventListener('click', () => {
    document.getElementById('mAuditDetailSheet')?.classList.remove('open');
  });

  // 7. Audits Search & Status Filters
  let auditSearchTimeout;
  const auditSearchInput = document.getElementById('mAuditSearch');
  const auditSearchClear = document.getElementById('mAuditSearchClear');

  auditSearchInput?.addEventListener('input', () => {
    clearTimeout(auditSearchTimeout);
    auditSearchClear.style.display = auditSearchInput.value ? 'block' : 'none';
    auditSearchTimeout = setTimeout(loadAuditsList, 300);
  });

  auditSearchClear?.addEventListener('click', () => {
    auditSearchInput.value = '';
    auditSearchClear.style.display = 'none';
    loadAuditsList();
  });

  document.querySelectorAll('#auditStatusChips .m-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#auditStatusChips .m-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentAuditStatusFilter = chip.getAttribute('data-status');
      loadAuditsList();
    });
  });

  document.getElementById('mBtnExportAudits')?.addEventListener('click', () => {
    exportToExcel(allAuditsData, 'approven_audits.xlsx');
  });

  // 8. Certification Bodies Search & Modal Listeners
  let cbSearchTimeout;
  const cbSearchInput = document.getElementById('mCbSearch');
  const cbSearchClear = document.getElementById('mCbSearchClear');

  cbSearchInput?.addEventListener('input', () => {
    clearTimeout(cbSearchTimeout);
    cbSearchClear.style.display = cbSearchInput.value ? 'block' : 'none';
    cbSearchTimeout = setTimeout(loadCbList, 300);
  });

  cbSearchClear?.addEventListener('click', () => {
    cbSearchInput.value = '';
    cbSearchClear.style.display = 'none';
    loadCbList();
  });

  document.querySelectorAll('#cbStatusChips .m-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#cbStatusChips .m-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentCbStatusFilter = chip.getAttribute('data-status');
      loadCbList();
    });
  });

  document.getElementById('mBtnAddCb')?.addEventListener('click', () => openEditCbModal(null));
  document.getElementById('mBtnCloseCbModal')?.addEventListener('click', attemptCloseMobileCbModal);
  document.getElementById('mBtnCancelCbModal')?.addEventListener('click', attemptCloseMobileCbModal);
  document.getElementById('mCbModalSheet')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('mCbModalSheet')) {
      attemptCloseMobileCbModal();
    }
  });
  document.getElementById('mBtnSaveCb')?.addEventListener('click', saveCb);
  document.getElementById('mBtnAddContactRow')?.addEventListener('click', addCbContactPrompt);

  // Modal Tabs for CB
  document.querySelectorAll('#mCbModalSheet .m-modal-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      if (tabId) switchModalTab('mCbModalSheet', tabId);
    });
  });

  // 9. Auditors Search & Modal Listeners
  let auditorSearchTimeout;
  const audSearchInput = document.getElementById('mAuditorSearch');
  const audSearchClear = document.getElementById('mAuditorSearchClear');

  audSearchInput?.addEventListener('input', () => {
    clearTimeout(auditorSearchTimeout);
    audSearchClear.style.display = audSearchInput.value ? 'block' : 'none';
    auditorSearchTimeout = setTimeout(loadAuditorsList, 300);
  });

  audSearchClear?.addEventListener('click', () => {
    audSearchInput.value = '';
    audSearchClear.style.display = 'none';
    loadAuditorsList();
  });

  document.querySelectorAll('#auditorStatusChips .m-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#auditorStatusChips .m-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentAuditorStatusFilter = chip.getAttribute('data-status');
      loadAuditorsList();
    });
  });

  document.getElementById('mBtnAddAuditor')?.addEventListener('click', () => openEditAuditorModal(null));
  document.getElementById('mBtnCloseAuditorModal')?.addEventListener('click', () => {
    document.getElementById('mAuditorModalSheet')?.classList.remove('open');
  });
  document.getElementById('mBtnCancelAuditorModal')?.addEventListener('click', () => {
    document.getElementById('mAuditorModalSheet')?.classList.remove('open');
  });
  document.getElementById('mBtnSaveAuditor')?.addEventListener('click', saveAuditor);
  document.getElementById('mBtnSeedPrograms')?.addEventListener('click', seedAuditorPrograms);

  // Modal Tabs for Auditor
  document.querySelectorAll('#mAuditorModalSheet .m-modal-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      if (tabId) switchModalTab('mAuditorModalSheet', tabId);
    });
  });

  // Initial Data Load
  loadSyncStatus();
  loadDashboardStats();
  loadDashboardAnalytics();
});
