// Approven Agenda (Calendar) & Timesheets Module

let agendaData = { auditors: [], cbs: [], events: [] };
let agendaViewMode = 'month'; // 'month' | 'week' | 'day'
let agendaSubTab = 'schedule'; // 'schedule' | 'timesheets' | 'audits' | 'report-writing'
let agendaHoverEl = null;

function _agEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function _agFmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function _agParseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function _agInitDefaultDates() {
  const fromEl = document.getElementById('agFromDate');
  const toEl = document.getElementById('agToDate');
  if (!fromEl || !toEl) return;
  if (!fromEl.value || !toEl.value) {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    fromEl.value = _agFmtDate(first);
    toEl.value = _agFmtDate(last);
  }
}

function toggleAgendaSidebarGroup(e) {
  if (e) e.preventDefault();
  const sub = document.getElementById('agSidebarSubmenu');
  if (sub) {
    const isOpen = sub.style.display !== 'none';
    sub.style.display = isOpen ? 'none' : 'block';
  }
}

function openAgendaSection(subTab = 'schedule') {
  // Activate Agenda view
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  const mainNav = document.querySelector('.nav-item[data-view="agenda"]');
  if (mainNav) mainNav.classList.add('active');
  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
  const viewEl = document.getElementById('view-agenda');
  if (viewEl) viewEl.classList.add('active');

  const subMenu = document.getElementById('agSidebarSubmenu');
  if (subMenu) subMenu.style.display = 'block';

  switchAgendaSubTab(subTab);
}

function switchAgendaSubTab(subTab) {
  agendaSubTab = subTab;
  document.querySelectorAll('#view-agenda .ag-subtab-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-ag-tab') === subTab);
  });
  document.querySelectorAll('#view-agenda .ag-subtab-pane').forEach(p => {
    p.style.display = (p.id === `agPane-${subTab}`) ? 'block' : 'none';
  });

  if (subTab === 'timesheets') {
    _tsInitDefaultDates();
    loadTimesheetsData();
  } else {
    _agInitDefaultDates();
    loadAgendaData();
  }
}

function setAgendaViewMode(mode) {
  agendaViewMode = mode;
  document.querySelectorAll('.ag-view-mode-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-mode') === mode);
  });
  const fromEl = document.getElementById('agFromDate');
  const toEl = document.getElementById('agToDate');
  const base = fromEl?.value ? _agParseDate(fromEl.value) : new Date();

  if (mode === 'month') {
    const first = new Date(base.getFullYear(), base.getMonth(), 1);
    const last = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    fromEl.value = _agFmtDate(first);
    toEl.value = _agFmtDate(last);
  } else if (mode === 'week') {
    const day = base.getDay();
    const diffToMon = (day === 0 ? -6 : 1 - day);
    const mon = new Date(base);
    mon.setDate(base.getDate() + diffToMon);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    fromEl.value = _agFmtDate(mon);
    toEl.value = _agFmtDate(sun);
  } else if (mode === 'day') {
    fromEl.value = _agFmtDate(base);
    toEl.value = _agFmtDate(base);
  }
  loadAgendaData();
}

function shiftAgendaPeriod(dir) {
  const fromEl = document.getElementById('agFromDate');
  const toEl = document.getElementById('agToDate');
  if (!fromEl || !toEl) return;
  const curFrom = fromEl.value ? _agParseDate(fromEl.value) : new Date();

  if (dir === 0) {
    const today = new Date();
    if (agendaViewMode === 'month') {
      fromEl.value = _agFmtDate(new Date(today.getFullYear(), today.getMonth(), 1));
      toEl.value = _agFmtDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));
    } else if (agendaViewMode === 'week') {
      const day = today.getDay();
      const mon = new Date(today);
      mon.setDate(today.getDate() + (day === 0 ? -6 : 1 - day));
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      fromEl.value = _agFmtDate(mon);
      toEl.value = _agFmtDate(sun);
    } else {
      fromEl.value = _agFmtDate(today);
      toEl.value = _agFmtDate(today);
    }
  } else if (agendaViewMode === 'month') {
    const nextFirst = new Date(curFrom.getFullYear(), curFrom.getMonth() + dir, 1);
    const nextLast = new Date(nextFirst.getFullYear(), nextFirst.getMonth() + 1, 0);
    fromEl.value = _agFmtDate(nextFirst);
    toEl.value = _agFmtDate(nextLast);
  } else if (agendaViewMode === 'week') {
    const f = new Date(curFrom);
    f.setDate(f.getDate() + dir * 7);
    const t = new Date(f);
    t.setDate(f.getDate() + 6);
    fromEl.value = _agFmtDate(f);
    toEl.value = _agFmtDate(t);
  } else {
    const f = new Date(curFrom);
    f.setDate(f.getDate() + dir);
    fromEl.value = _agFmtDate(f);
    toEl.value = _agFmtDate(f);
  }
  loadAgendaData();
}

async function loadAgendaData() {
  _agInitDefaultDates();
  const start = document.getElementById('agFromDate')?.value;
  const end = document.getElementById('agToDate')?.value;
  const auditorId = document.getElementById('agAuditorFilter')?.value || '';
  if (!start || !end) return;

  const qs = new URLSearchParams({ start, end });
  if (auditorId) qs.set('auditor_id', auditorId);

  try {
    const resp = await fetch(`/api/agenda/events?${qs.toString()}`);
    if (resp.status === 401) { window.location.href = '/login'; return; }
    if (!resp.ok) {
      const errTxt = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${errTxt}`);
    }
    agendaData = await resp.json();
    _populateAgendaSelects();
    renderAgendaScheduleGrid();
    renderAgendaAuditsList();
    renderAgendaReportWritingList();
  } catch (err) {
    console.error(err);
    const wrap = document.getElementById('agScheduleGridWrap');
    if (wrap) {
      wrap.innerHTML = `<div style="padding:1.5rem;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;">
        <strong>Unable to load Agenda data:</strong> ${_agEsc(err.message)}<br>
        <small style="color:#7f1d1d;">If you just updated the server code, please restart the Dev server (stop_server_dev.bat / start_server_dev.bat) so the new /api/agenda endpoints are loaded.</small>
      </div>`;
    }
  }
}

function _populateAgendaSelects() {
  const audFilter = document.getElementById('agAuditorFilter');
  const tsAudFilter = document.getElementById('tsAuditorFilter');
  const tsCbFilter = document.getElementById('tsCBFilter');
  const evtAudSel = document.getElementById('agEvtAuditor');
  const tsModalAud = document.getElementById('tsModalAuditor');
  const tsModalCb = document.getElementById('tsModalCB');

  const audOpts = agendaData.auditors
    .map(a => `<option value="${a.AuditorID}">${_agEsc(a.FullName)}</option>`)
    .join('');
  const cbOpts = agendaData.cbs
    .map(c => `<option value="${c.ID}">${_agEsc(c.Company_Name)}</option>`)
    .join('');

  if (audFilter) {
    const cur = audFilter.value;
    audFilter.innerHTML = '<option value="">All Active Auditors</option>' + audOpts;
    if (cur) audFilter.value = cur;
  }
  if (tsAudFilter) {
    const cur = tsAudFilter.value;
    tsAudFilter.innerHTML = '<option value="">All Auditors</option>' + audOpts;
    if (cur) tsAudFilter.value = cur;
  }
  if (tsCbFilter) {
    const cur = tsCbFilter.value;
    tsCbFilter.innerHTML = '<option value="">All Certification Bodies</option>' + cbOpts;
    if (cur) tsCbFilter.value = cur;
  }
  if (evtAudSel) {
    const cur = evtAudSel.value;
    evtAudSel.innerHTML = '<option value="">All / Company-Wide (e.g. Public Holiday)</option>' + audOpts;
    if (cur) evtAudSel.value = cur;
  }
  if (tsModalAud) {
    const cur = tsModalAud.value;
    tsModalAud.innerHTML = '<option value="">-- Select Auditor --</option>' + audOpts;
    if (cur) tsModalAud.value = cur;
  }
  if (tsModalCb) {
    const cur = tsModalCb.value;
    tsModalCb.innerHTML = '<option value="">-- Optional CB --</option>' + cbOpts;
    if (cur) tsModalCb.value = cur;
  }
}

function _agDaysBetween(startStr, endStr) {
  const days = [];
  let cur = _agParseDate(startStr);
  const end = _agParseDate(endStr);
  let guard = 0;
  while (cur <= end && guard < 95) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
  return days;
}

function renderAgendaScheduleGrid() {
  const container = document.getElementById('agScheduleGridWrap');
  if (!container) return;
  const startStr = document.getElementById('agFromDate')?.value;
  const endStr = document.getElementById('agToDate')?.value;
  const filterAid = document.getElementById('agAuditorFilter')?.value || '';
  if (!startStr || !endStr) return;

  const days = _agDaysBetween(startStr, endStr);
  const todayStr = _agFmtDate(new Date());
  const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const labelEl = document.getElementById('agPeriodLabel');
  if (labelEl && days.length) {
    const d0 = days[0];
    const d1 = days[days.length - 1];
    labelEl.textContent = (d0.getMonth() === d1.getMonth() && d0.getFullYear() === d1.getFullYear())
      ? `${monthNames[d0.getMonth()]} ${d0.getFullYear()}`
      : `${d0.getDate()} ${monthNames[d0.getMonth()]} – ${d1.getDate()} ${monthNames[d1.getMonth()]} ${d1.getFullYear()}`;
  }

  const auditorsToShow = filterAid
    ? agendaData.auditors.filter(a => String(a.AuditorID) === String(filterAid))
    : agendaData.auditors;

  // Build lookup: eventsByAudDay[audKey][dateStr] = [...]
  const eventsByAudDay = {};
  agendaData.events.forEach(ev => {
    const aKey = (ev.auditor_id === null || ev.auditor_id === undefined) ? 'company' : String(ev.auditor_id);
    const evStart = ev.start_date;
    const evEnd = ev.end_date || ev.start_date;
    days.forEach(d => {
      const ds = _agFmtDate(d);
      if (ds >= evStart && ds <= evEnd) {
        eventsByAudDay[aKey] = eventsByAudDay[aKey] || {};
        eventsByAudDay[aKey][ds] = eventsByAudDay[aKey][ds] || [];
        eventsByAudDay[aKey][ds].push(ev);
      }
    });
  });

  // Header row
  const thCells = days.map(d => {
    const ds = _agFmtDate(d);
    const isWknd = d.getDay() === 0 || d.getDay() === 6;
    const isToday = ds === todayStr;
    return `<th class="ag-day-hdr ${isWknd ? 'ag-wknd' : ''} ${isToday ? 'ag-today' : ''}">
      <div>${dayNames[d.getDay()]}</div>
      <div class="ag-day-num">${d.getDate()}</div>
    </th>`;
  }).join('');

  const renderRow = (rowKey, label, subLabel, auditorIdVal) => {
    const cells = days.map(d => {
      const ds = _agFmtDate(d);
      const isWknd = d.getDay() === 0 || d.getDay() === 6;
      const isToday = ds === todayStr;
      const list = (eventsByAudDay[rowKey] && eventsByAudDay[rowKey][ds]) || [];

      const blocks = list.map(ev => {
        const dotColor = ev.status_light === 'green'
          ? '#10b981'
          : (ev.status_light === 'orange' ? '#f59e0b' : '#3b82f6');
        let cls = 'ag-blk-audit';
        if (ev.kind === 'report') cls = 'ag-blk-report';
        else if (ev.kind === 'custom') cls = 'ag-blk-custom';
        if (ev.status_light === 'orange') cls += ' ag-blk-unconfirmed';

        const evIdx = agendaData.events.indexOf(ev);
        const hrsTag = ev.hours_per_day ? `${ev.hours_per_day}h` : '';
        return `<div class="ag-block ${cls}"
                     onmouseenter="showAgendaTooltip(event, ${evIdx})"
                     onmouseleave="hideAgendaTooltip()"
                     ondblclick="onDblClickAgendaEvent(event, ${evIdx})">
          <span class="ag-dot" style="background:${dotColor};" title="${_agEsc(ev.status_label)}"></span>
          <span class="ag-blk-txt">${hrsTag ? `<b>${hrsTag}</b> ` : ''}${_agEsc(ev.title)}</span>
        </div>`;
      }).join('');

      return `<td class="ag-cell ${isWknd ? 'ag-wknd' : ''} ${isToday ? 'ag-today' : ''}"
                  ondblclick="openNewAgendaEventModal(${auditorIdVal === null ? 'null' : auditorIdVal}, '${ds}')">
                ${blocks}
              </td>`;
    }).join('');

    return `<tr>
      <td class="ag-aud-col">
        <div class="ag-aud-name">${_agEsc(label)}</div>
        ${subLabel ? `<div class="ag-aud-sub">${_agEsc(subLabel)}</div>` : ''}
      </td>
      ${cells}
    </tr>`;
  };

  let bodyRows = renderRow('company', '* Company / Public Holidays', 'All Auditors', null);
  auditorsToShow.forEach(a => {
    const loc = [a.Residence_City, a.Residence_Country].filter(Boolean).join(', ');
    bodyRows += renderRow(String(a.AuditorID), a.FullName, loc, a.AuditorID);
  });

  container.innerHTML = `
    <table class="ag-grid-table ${agendaViewMode === 'day' ? 'ag-mode-day' : (agendaViewMode === 'week' ? 'ag-mode-week' : '')}">
      <thead>
        <tr>
          <th class="ag-aud-col ag-aud-hdr">Auditor / Resource</th>
          ${thCells}
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;
}

function showAgendaTooltip(e, evIdx) {
  const ev = agendaData.events[evIdx];
  if (!ev) return;
  if (!agendaHoverEl) {
    agendaHoverEl = document.createElement('div');
    agendaHoverEl.id = 'agHoverTooltip';
    agendaHoverEl.className = 'ag-hover-tooltip';
    document.body.appendChild(agendaHoverEl);
  }
  const dotColor = ev.status_light === 'green' ? '#10b981' : (ev.status_light === 'orange' ? '#f59e0b' : '#60a5fa');

  let bodyHtml = '';
  if (ev.source === 'workflow' && ev.meta) {
    const m = ev.meta;
    bodyHtml = `
      <div class="ag-tt-title">${_agEsc(m.auditee)} (${_agEsc(m.project_nr)}) | ${_agEsc(m.cb_name || '-')}</div>
      <div class="ag-tt-status"><span class="ag-dot" style="background:${dotColor};"></span> ${_agEsc(ev.status_label)} &bull; ${_agEsc(ev.role)} (${ev.hours_per_day}h/day)</div>
      <div class="ag-tt-grid">
        <div><strong>Dates:</strong> ${_agEsc(ev.start_date)}${ev.end_date !== ev.start_date ? ` to ${_agEsc(ev.end_date)}` : ''}</div>
        <div><strong>Program:</strong> ${_agEsc(m.program || '-')} | <strong>Type:</strong> ${_agEsc(m.audit_type || '-')}</div>
        <div><strong>Audit Days:</strong> ${m.audit_days ?? '-'} | <strong>Mandays:</strong> ${m.total_mandays ?? '-'}</div>
        <div><strong>Announcement:</strong> ${_agEsc(m.announcement || '-')}${m.window ? ` (${_agEsc(m.window)})` : ''}</div>
        <div><strong>Site Address:</strong> ${_agEsc(m.site_address || m.site_name || '-')}</div>
        ${m.notes ? `<div><strong>Notes:</strong> ${_agEsc(m.notes)}</div>` : ''}
      </div>
      <div class="ag-tt-hint">Double-click to open Audit Workflow #${m.wfid}</div>
    `;
  } else {
    bodyHtml = `
      <div class="ag-tt-title">${_agEsc(ev.title)}</div>
      <div class="ag-tt-status"><span class="ag-dot" style="background:${dotColor};"></span> ${_agEsc(ev.event_type || 'Event')} (${ev.hours_per_day}h/day)</div>
      <div class="ag-tt-grid">
        <div><strong>Dates:</strong> ${_agEsc(ev.start_date)}${ev.end_date !== ev.start_date ? ` to ${_agEsc(ev.end_date)}` : ''}</div>
        ${ev.notes ? `<div><strong>Notes:</strong> ${_agEsc(ev.notes)}</div>` : ''}
      </div>
      <div class="ag-tt-hint">Double-click to edit event</div>
    `;
  }

  agendaHoverEl.innerHTML = bodyHtml;
  agendaHoverEl.style.display = 'block';

  const pad = 12;
  let left = e.clientX + pad;
  let top = e.clientY + pad;
  const rect = agendaHoverEl.getBoundingClientRect();
  if (left + rect.width > window.innerWidth - 10) left = Math.max(10, e.clientX - rect.width - pad);
  if (top + rect.height > window.innerHeight - 10) top = Math.max(10, e.clientY - rect.height - pad);
  agendaHoverEl.style.left = `${left}px`;
  agendaHoverEl.style.top = `${top}px`;
}

function hideAgendaTooltip() {
  if (agendaHoverEl) agendaHoverEl.style.display = 'none';
}

function onDblClickAgendaEvent(e, evIdx) {
  if (e) e.stopPropagation();
  hideAgendaTooltip();
  const ev = agendaData.events[evIdx];
  if (!ev) return;
  if (ev.source === 'workflow' && ev.wfid) {
    if (typeof openWorkflowModal === 'function') openWorkflowModal(ev.wfid);
  } else if (ev.source === 'custom' && ev.event_id) {
    openEditAgendaEventModal(ev);
  }
}

function openNewAgendaEventModal(auditorId, dateStr) {
  hideAgendaTooltip();
  document.getElementById('agEvtId').value = '';
  document.getElementById('agEvtModalTitle').textContent = 'New Agenda Event (Non-Audit)';
  document.getElementById('agEvtType').value = 'Annual Leave';
  document.getElementById('agEvtTitle').value = '';
  document.getElementById('agEvtAuditor').value = auditorId ? String(auditorId) : '';
  document.getElementById('agEvtStart').value = dateStr || _agFmtDate(new Date());
  document.getElementById('agEvtEnd').value = dateStr || _agFmtDate(new Date());
  document.getElementById('agEvtHours').value = '8';
  document.getElementById('agEvtNotes').value = '';
  document.getElementById('btnDeleteAgendaEvt').style.display = 'none';
  document.getElementById('agendaEventModal').style.display = 'flex';
}

function openEditAgendaEventModal(ev) {
  document.getElementById('agEvtId').value = ev.event_id;
  document.getElementById('agEvtModalTitle').textContent = 'Edit Agenda Event';
  document.getElementById('agEvtType').value = ev.event_type || 'Other';
  document.getElementById('agEvtTitle').value = ev.title || '';
  document.getElementById('agEvtAuditor').value = ev.auditor_id ? String(ev.auditor_id) : '';
  document.getElementById('agEvtStart').value = ev.start_date || '';
  document.getElementById('agEvtEnd').value = ev.end_date || ev.start_date || '';
  document.getElementById('agEvtHours').value = ev.hours_per_day ?? 8;
  document.getElementById('agEvtNotes').value = ev.notes || '';
  document.getElementById('btnDeleteAgendaEvt').style.display = 'inline-block';
  document.getElementById('agendaEventModal').style.display = 'flex';
}

function closeAgendaEventModal() {
  document.getElementById('agendaEventModal').style.display = 'none';
}

async function saveAgendaEventModal() {
  const id = document.getElementById('agEvtId').value;
  const payload = {
    EventType: document.getElementById('agEvtType').value,
    Title: document.getElementById('agEvtTitle').value.trim() || document.getElementById('agEvtType').value,
    AuditorID: document.getElementById('agEvtAuditor').value || null,
    StartDate: document.getElementById('agEvtStart').value,
    EndDate: document.getElementById('agEvtEnd').value || document.getElementById('agEvtStart').value,
    HoursPerDay: parseFloat(document.getElementById('agEvtHours').value) || 8,
    Notes: document.getElementById('agEvtNotes').value.trim()
  };
  if (!payload.StartDate) { alert('Start Date is required.'); return; }

  const url = id ? `/api/agenda/events/${id}` : '/api/agenda/events';
  const method = id ? 'PUT' : 'POST';
  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) { alert('Failed to save event.'); return; }
  closeAgendaEventModal();
  loadAgendaData();
}

async function deleteAgendaEventModal() {
  const id = document.getElementById('agEvtId').value;
  if (!id || !confirm('Delete this agenda event?')) return;
  const resp = await fetch(`/api/agenda/events/${id}`, { method: 'DELETE' });
  if (!resp.ok) { alert('Failed to delete event.'); return; }
  closeAgendaEventModal();
  loadAgendaData();
}

function renderAgendaAuditsList() {
  const tbody = document.getElementById('agAuditsTableBody');
  if (!tbody) return;
  const audMap = Object.fromEntries(agendaData.auditors.map(a => [String(a.AuditorID), a.FullName]));
  const list = agendaData.events.filter(e => e.kind === 'audit');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#64748b;padding:1.5rem;">No audits scheduled in this period.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(ev => {
    const dot = ev.status_light === 'green' ? '#10b981' : '#f59e0b';
    const m = ev.meta || {};
    return `<tr style="cursor:pointer;" ondblclick="openWorkflowModal(${ev.wfid})">
      <td><span class="ag-dot" style="background:${dot};"></span> ${_agEsc(ev.status_label)}</td>
      <td><strong>${_agEsc(audMap[String(ev.auditor_id)] || '-')}</strong> <span style="color:#64748b;font-size:0.78rem;">(${_agEsc(ev.role)})</span></td>
      <td>${_agEsc(ev.start_date)} &rarr; ${_agEsc(ev.end_date)}</td>
      <td><strong>${_agEsc(m.auditee)}</strong></td>
      <td>${_agEsc(m.cb_name || '-')}</td>
      <td>${_agEsc(m.project_nr || '-')}</td>
      <td>${_agEsc(m.program || '-')}</td>
    </tr>`;
  }).join('');
}

function renderAgendaReportWritingList() {
  const tbody = document.getElementById('agReportWritingTableBody');
  if (!tbody) return;
  const audMap = Object.fromEntries(agendaData.auditors.map(a => [String(a.AuditorID), a.FullName]));
  const list = agendaData.events.filter(e => e.kind === 'report');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#64748b;padding:1.5rem;">No report writing allocations in this period.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(ev => {
    const dot = ev.status_light === 'green' ? '#10b981' : '#f59e0b';
    const m = ev.meta || {};
    return `<tr style="cursor:pointer;" ondblclick="openWorkflowModal(${ev.wfid})">
      <td><span class="ag-dot" style="background:${dot};"></span> ${_agEsc(ev.status_label)}</td>
      <td><strong>${_agEsc(audMap[String(ev.auditor_id)] || '-')}</strong></td>
      <td>${_agEsc(ev.start_date)} <span style="color:#64748b;font-size:0.78rem;">(${ev.hours_per_day}h)</span></td>
      <td><strong>${_agEsc(m.auditee)}</strong></td>
      <td>${_agEsc(m.cb_name || '-')}</td>
      <td>${_agEsc(m.project_nr || '-')}</td>
    </tr>`;
  }).join('');
}

// ==================== TIMESHEETS ====================
function _tsInitDefaultDates() {
  const fromEl = document.getElementById('tsFromDate');
  const toEl = document.getElementById('tsToDate');
  if (!fromEl || !toEl) return;
  if (!fromEl.value || !toEl.value) {
    const now = new Date();
    const day = now.getDay();
    const mon = new Date(now);
    mon.setDate(now.getDate() + (day === 0 ? -6 : 1 - day));
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    fromEl.value = _agFmtDate(mon);
    toEl.value = _agFmtDate(sun);
  }
}

function shiftTimesheetWeek(dir) {
  _tsInitDefaultDates();
  const fromEl = document.getElementById('tsFromDate');
  const toEl = document.getElementById('tsToDate');
  const f = dir === 0 ? new Date() : _agParseDate(fromEl.value);
  if (dir === 0) {
    const day = f.getDay();
    f.setDate(f.getDate() + (day === 0 ? -6 : 1 - day));
  } else {
    f.setDate(f.getDate() + dir * 7);
  }
  const t = new Date(f);
  t.setDate(f.getDate() + 6);
  fromEl.value = _agFmtDate(f);
  toEl.value = _agFmtDate(t);
  loadTimesheetsData();
}

async function loadTimesheetsData() {
  _tsInitDefaultDates();
  const start = document.getElementById('tsFromDate')?.value;
  const end = document.getElementById('tsToDate')?.value;
  const auditorId = document.getElementById('tsAuditorFilter')?.value || '';
  const cbId = document.getElementById('tsCBFilter')?.value || '';
  if (!start || !end) return;

  if (!agendaData.auditors.length) {
    await loadAgendaData();
  }

  const qs = new URLSearchParams({ start, end });
  if (auditorId) qs.set('auditor_id', auditorId);
  if (cbId) qs.set('cb_id', cbId);

  const resp = await fetch(`/api/timesheets?${qs.toString()}`);
  if (!resp.ok) return;
  const data = await resp.json();
  renderTimesheetsPanels(data.entries || [], data.allocated || []);
}

function renderTimesheetsPanels(entries, allocated) {
  const leftEl = document.getElementById('tsEntriesPanel');
  const rightEl = document.getElementById('tsComparisonPanel');
  if (!leftEl || !rightEl) return;

  // Left panel: grouped by EntryDate
  if (!entries.length) {
    leftEl.innerHTML = '<div style="padding:1.5rem;text-align:center;color:#64748b;">No timesheet entries logged for this period/filter. Click <strong>Sync from Costings</strong> or <strong>+ Log Time</strong>.</div>';
  } else {
    const byDate = {};
    entries.forEach(e => {
      byDate[e.EntryDate] = byDate[e.EntryDate] || [];
      byDate[e.EntryDate].push(e);
    });
    leftEl.innerHTML = Object.keys(byDate).sort().reverse().map(dt => {
      const list = byDate[dt];
      const daySum = list.reduce((a, x) => a + Number(x.Hours || 0), 0);
      const rowsHtml = list.map(e => {
        const stBadge = e.Status === 'Approved'
          ? '<span class="status-badge complete">Approved</span>'
          : (e.Status === 'Rejected' ? '<span class="status-badge inactive">Rejected</span>' : '<span class="status-badge pending">Submitted</span>');
        return `<div class="ts-entry-row">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;color:#0f172a;">${_agEsc(e.Category)} &bull; ${_agEsc(e.Description || e.Auditee_Name || '-')}</div>
            <div style="font-size:0.78rem;color:#64748b;">${_agEsc(e.AuditorName || '-')}${e.CB_Name ? ` | ${_agEsc(e.CB_Name)}` : ''} ${e.Billable ? '' : '<span class="status-badge" style="background:#f1f5f9;color:#475569;font-size:0.68rem;">Non-Billable</span>'}</div>
          </div>
          <div style="display:flex;align-items:center;gap:0.45rem;">
            ${stBadge}
            <strong style="min-width:48px;text-align:right;">${Number(e.Hours).toFixed(2)}h</strong>
            <button type="button" class="btn-secondary" style="padding:0.15rem 0.4rem;font-size:0.72rem;" title="Approve" onclick="setTimesheetStatus(${e.ID}, 'Approved')">&#10003;</button>
            <button type="button" class="btn-secondary" style="padding:0.15rem 0.4rem;font-size:0.72rem;color:#b91c1c;" title="Delete" onclick="deleteTimesheetEntry(${e.ID})">&times;</button>
          </div>
        </div>`;
      }).join('');
      return `<div class="ts-day-card">
        <div class="ts-day-hdr"><span>${_agEsc(dt)}</span><strong>${daySum.toFixed(2)}h</strong></div>
        ${rowsHtml}
      </div>`;
    }).join('');
  }

  // Right panel: Allocated vs Actual grouped by CB -> Project (Page 2 of Word doc style)
  const cbGroups = {};
  allocated.forEach(a => {
    const cbKey = a.cb_name || 'Unassigned CB';
    cbGroups[cbKey] = cbGroups[cbKey] || { sched: 0, logged: 0, items: [] };
    cbGroups[cbKey].sched += Number(a.scheduled_hours || 0) + Number(a.travel_hours || 0);
    cbGroups[cbKey].items.push(a);
  });
  entries.forEach(e => {
    const cbKey = e.CB_Name || 'Internal / Unassigned CB';
    cbGroups[cbKey] = cbGroups[cbKey] || { sched: 0, logged: 0, items: [] };
    cbGroups[cbKey].logged += Number(e.Hours || 0);
  });

  const cbNames = Object.keys(cbGroups).sort();
  if (!cbNames.length) {
    rightEl.innerHTML = '<div style="padding:1.5rem;text-align:center;color:#64748b;">No allocated or logged hours in this period.</div>';
    return;
  }

  rightEl.innerHTML = `
    <div style="font-weight:700;color:#001429;margin-bottom:0.6rem;">Allocated (Costing) vs. Logged Summary</div>
    <table class="data-table compact-audits-table">
      <thead>
        <tr>
          <th>Certification Body</th>
          <th style="text-align:right;">Scheduled</th>
          <th style="text-align:right;">Logged</th>
          <th style="text-align:right;">Variance</th>
        </tr>
      </thead>
      <tbody>
        ${cbNames.map(cb => {
          const g = cbGroups[cb];
          const diff = g.logged - g.sched;
          const diffTxt = diff === 0 ? '0.00h' : (diff > 0 ? `+${diff.toFixed(2)}h` : `${diff.toFixed(2)}h`);
          const diffCol = diff > 0 ? '#b45309' : (diff < 0 ? '#64748b' : '#10b981');
          return `<tr>
            <td><strong>${_agEsc(cb)}</strong></td>
            <td style="text-align:right;">${g.sched.toFixed(2)}h</td>
            <td style="text-align:right;font-weight:700;">${g.logged.toFixed(2)}h</td>
            <td style="text-align:right;color:${diffCol};font-weight:600;">${diffTxt}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

async function syncTimesheetsFromCostings() {
  const start = document.getElementById('tsFromDate')?.value;
  const end = document.getElementById('tsToDate')?.value;
  const auditor_id = document.getElementById('tsAuditorFilter')?.value || null;
  const cb_id = document.getElementById('tsCBFilter')?.value || null;
  const resp = await fetch('/api/timesheets/sync-from-costings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start, end, auditor_id, cb_id })
  });
  const data = await resp.json();
  if (!resp.ok) { alert(data.detail || 'Sync failed'); return; }
  alert(`Synced ${data.created} timesheet entries from scheduled audits & costings.`);
  loadTimesheetsData();
}

function openNewTimesheetModal() {
  document.getElementById('tsModalDate').value = document.getElementById('tsFromDate')?.value || _agFmtDate(new Date());
  document.getElementById('tsModalHours').value = '8';
  document.getElementById('tsModalDesc').value = '';
  document.getElementById('tsEntryModal').style.display = 'flex';
}

function closeTimesheetModal() {
  document.getElementById('tsEntryModal').style.display = 'none';
}

async function saveTimesheetModal() {
  const payload = {
    AuditorID: document.getElementById('tsModalAuditor').value,
    CBID: document.getElementById('tsModalCB').value || null,
    Category: document.getElementById('tsModalCategory').value,
    EntryDate: document.getElementById('tsModalDate').value,
    Hours: parseFloat(document.getElementById('tsModalHours').value) || 0,
    Billable: document.getElementById('tsModalBillable').checked,
    Description: document.getElementById('tsModalDesc').value.trim()
  };
  if (!payload.AuditorID || !payload.EntryDate || payload.Hours <= 0) {
    alert('Auditor, Date, and positive Hours are required.');
    return;
  }
  const resp = await fetch('/api/timesheets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) { alert('Failed to save timesheet entry.'); return; }
  closeTimesheetModal();
  loadTimesheetsData();
}

async function setTimesheetStatus(id, status) {
  await fetch(`/api/timesheets/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Status: status })
  });
  loadTimesheetsData();
}

async function deleteTimesheetEntry(id) {
  if (!confirm('Delete this timesheet entry?')) return;
  await fetch(`/api/timesheets/${id}`, { method: 'DELETE' });
  loadTimesheetsData();
}
