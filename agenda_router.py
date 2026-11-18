from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

import pyodbc
from fastapi import APIRouter, HTTPException, Request

from db_config import DB_CONN_STR

agenda_router = APIRouter()


def get_db_connection():
    return pyodbc.connect(DB_CONN_STR)


def execute_query(query: str, params: tuple = ()):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(query, params)
        if cursor.description:
            columns = [column[0] for column in cursor.description]
            rows = cursor.fetchall()
            return [dict(zip(columns, row)) for row in rows]
        conn.commit()
        return []
    finally:
        cursor.close()
        conn.close()


def _require_user(request: Request) -> dict:
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return user


def _ensure_agenda_tables():
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tbl_Agenda_Events')
            CREATE TABLE dbo.tbl_Agenda_Events (
                ID INT IDENTITY(1,1) PRIMARY KEY,
                AuditorID INT NULL,
                EventType NVARCHAR(50) NOT NULL,
                Title NVARCHAR(255) NOT NULL,
                StartDate DATE NOT NULL,
                EndDate DATE NOT NULL,
                HoursPerDay DECIMAL(5,2) NULL DEFAULT 8.00,
                Notes NVARCHAR(MAX) NULL,
                CreatedBy NVARCHAR(100) NULL,
                CreatedDate DATETIME DEFAULT GETDATE()
            );
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tbl_Timesheets')
            CREATE TABLE dbo.tbl_Timesheets (
                ID INT IDENTITY(1,1) PRIMARY KEY,
                AuditorID INT NOT NULL,
                WFID INT NULL,
                CBID INT NULL,
                Category NVARCHAR(50) NOT NULL,
                EntryDate DATE NOT NULL,
                Hours DECIMAL(5,2) NOT NULL,
                Billable BIT NOT NULL DEFAULT 1,
                Status NVARCHAR(30) NOT NULL DEFAULT 'Submitted',
                Description NVARCHAR(500) NULL,
                CreatedBy NVARCHAR(100) NULL,
                CreatedDate DATETIME DEFAULT GETDATE()
            );
            """
        )
        conn.commit()
    finally:
        cur.close()
        conn.close()


try:
    _ensure_agenda_tables()
except Exception as _exc:
    print(f"Warning: could not ensure agenda tables: {_exc}")


def _to_date(val: Any) -> Optional[date]:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    s = str(val).strip()[:10]
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        return None


def _next_weekday(d: date) -> date:
    nxt = d + timedelta(days=1)
    while nxt.weekday() >= 5:  # 5 = Saturday, 6 = Sunday
        nxt += timedelta(days=1)
    return nxt


def _build_audit_and_report_entries(
    start_d: date, end_d: date, auditor_id: Optional[int] = None
) -> List[Dict[str, Any]]:
    """Builds audit & report-writing agenda entries from tbl_WorkflowProcess overlapping [start_d, end_d]."""
    # Query slightly wider start/end window so report-writing day-after-audit on boundary is captured
    q_start = (start_d - timedelta(days=5)).strftime("%Y-%m-%d")
    q_end = end_d.strftime("%Y-%m-%d")

    rows = execute_query(
        """
        SELECT wf.WFID, wf.Status, wf.Project_Nr, wf.Audit_Program, wf.Audit_Type,
               wf.Announcement, wf.Audit_Start_Date, wf.Audit_End_Date,
               wf.AuditWindow_From, wf.AuditWindow_To, wf.Audit_Days, wf.Total_Mandays,
               wf.Auditor1, wf.Auditor2, wf.Auditor3,
               wf.Email_QuoteRequest_Details, wf.Quote_Addit_Comments,
               wf.Certification_Body AS CBID,
               cb.Company_Name AS CB_Name,
               aud.Company_Name AS Auditee_Name,
               s.SiteName, s.Address AS Site_Address, s.Country AS Site_Country
        FROM dbo.tbl_WorkflowProcess wf
        LEFT JOIN dbo.tbl_Certification_Bodies cb ON wf.Certification_Body = cb.ID
        LEFT JOIN dbo.tbl_Auditees aud ON wf.AuditeeID = aud.ID
        LEFT JOIN dbo.tbl_AuditeeSites s ON wf.SiteID = s.ID
        WHERE wf.Audit_Start_Date IS NOT NULL
          AND COALESCE(wf.Status, 'Pending') <> 'Cancelled'
          AND CAST(wf.Audit_Start_Date AS DATE) <= ?
          AND CAST(COALESCE(wf.Audit_End_Date, wf.Audit_Start_Date) AS DATE) >= ?
        ORDER BY wf.Audit_Start_Date ASC
        """,
        (q_end, q_start),
    )

    entries: List[Dict[str, Any]] = []
    for r in rows:
        a_start = _to_date(r.get("Audit_Start_Date"))
        a_end = _to_date(r.get("Audit_End_Date")) or a_start
        if not a_start:
            continue
        if a_end < a_start:
            a_end = a_start

        wf_status = (r.get("Status") or "Pending").strip()
        is_confirmed = wf_status in ("Confirmed", "Complete")
        agenda_status = wf_status if is_confirmed else "Unconfirmed"
        light = "green" if is_confirmed else "orange"

        auditee = r.get("Auditee_Name") or r.get("SiteName") or f"Workflow #{r['WFID']}"
        proj = r.get("Project_Nr") or f"WF-{r['WFID']}"
        cb_name = r.get("CB_Name") or ""
        site_loc = ", ".join(p for p in [r.get("Site_Address"), r.get("Site_Country")] if p)
        win_from = _to_date(r.get("AuditWindow_From"))
        win_to = _to_date(r.get("AuditWindow_To"))
        window_str = f"{win_from} to {win_to}" if (win_from or win_to) else ""

        meta = {
            "wfid": r["WFID"],
            "project_nr": proj,
            "cb_id": r.get("CBID"),
            "cb_name": cb_name,
            "auditee": auditee,
            "site_name": r.get("SiteName") or "",
            "site_address": site_loc,
            "program": r.get("Audit_Program") or "",
            "audit_type": r.get("Audit_Type") or "",
            "announcement": r.get("Announcement") or "",
            "window": window_str,
            "audit_days": float(r["Audit_Days"]) if r.get("Audit_Days") is not None else None,
            "total_mandays": float(r["Total_Mandays"]) if r.get("Total_Mandays") is not None else None,
            "wf_status": wf_status,
            "notes": (r.get("Email_QuoteRequest_Details") or r.get("Quote_Addit_Comments") or "").strip(),
        }

        assigned = []
        if r.get("Auditor1"):
            assigned.append(("Auditor1", int(r["Auditor1"])))
        if r.get("Auditor2"):
            assigned.append(("Auditor2", int(r["Auditor2"])))
        if r.get("Auditor3"):
            assigned.append(("Auditor3", int(r["Auditor3"])))

        for role, aid in assigned:
            if auditor_id and aid != auditor_id:
                continue
            if a_start <= end_d and a_end >= start_d:
                entries.append(
                    {
                        "id": f"wf-{r['WFID']}-{role}",
                        "source": "workflow",
                        "kind": "audit",
                        "wfid": r["WFID"],
                        "auditor_id": aid,
                        "role": role,
                        "title": f"{auditee} ({proj})",
                        "subtitle": cb_name,
                        "start_date": a_start.isoformat(),
                        "end_date": a_end.isoformat(),
                        "hours_per_day": 8.0,
                        "status_label": agenda_status,
                        "status_light": light,
                        "meta": meta,
                    }
                )

            # Report Writing: weekday immediately after Audit_End_Date for Lead Auditor (Auditor1)
            if role == "Auditor1":
                rep_day = _next_weekday(a_end)
                if start_d <= rep_day <= end_d:
                    entries.append(
                        {
                            "id": f"rep-{r['WFID']}-{aid}",
                            "source": "workflow",
                            "kind": "report",
                            "wfid": r["WFID"],
                            "auditor_id": aid,
                            "role": "Report Writing",
                            "title": f"REPORT: {auditee} ({proj})",
                            "subtitle": cb_name,
                            "start_date": rep_day.isoformat(),
                            "end_date": rep_day.isoformat(),
                            "hours_per_day": 4.0,
                            "status_label": agenda_status,
                            "status_light": light,
                            "meta": meta,
                        }
                    )
    return entries


@agenda_router.get("/api/agenda/events")
async def get_agenda_events(
    request: Request,
    start: str,
    end: str,
    auditor_id: Optional[int] = None,
):
    _require_user(request)
    start_d = _to_date(start)
    end_d = _to_date(end)
    if not start_d or not end_d:
        raise HTTPException(status_code=400, detail="Valid start and end dates (YYYY-MM-DD) are required.")

    auditors = execute_query(
        """
        SELECT AuditorID, First_Name, Last_Name, Residence_City, Residence_Country, Status
        FROM dbo.tbl_Auditors
        WHERE Status = 'Active' OR Status IS NULL
        ORDER BY First_Name, Last_Name
        """
    )
    for a in auditors:
        a["FullName"] = f"{a.get('First_Name') or ''} {a.get('Last_Name') or ''}".strip()

    cbs = execute_query("SELECT ID, Company_Name FROM dbo.tbl_Certification_Bodies ORDER BY Company_Name")

    events = _build_audit_and_report_entries(start_d, end_d, auditor_id=auditor_id)

    custom_rows = execute_query(
        """
        SELECT ID, AuditorID, EventType, Title, StartDate, EndDate, HoursPerDay, Notes, CreatedBy
        FROM dbo.tbl_Agenda_Events
        WHERE StartDate <= ? AND EndDate >= ?
        ORDER BY StartDate ASC, ID ASC
        """,
        (end_d.strftime("%Y-%m-%d"), start_d.strftime("%Y-%m-%d")),
    )
    for c in custom_rows:
        c_aid = c.get("AuditorID")
        if auditor_id and c_aid is not None and int(c_aid) != auditor_id:
            continue
        cs = _to_date(c.get("StartDate"))
        ce = _to_date(c.get("EndDate")) or cs
        events.append(
            {
                "id": f"evt-{c['ID']}",
                "event_id": c["ID"],
                "source": "custom",
                "kind": "custom",
                "event_type": c.get("EventType") or "Other",
                "auditor_id": c_aid,
                "title": c.get("Title") or c.get("EventType") or "Event",
                "subtitle": c.get("EventType") or "",
                "start_date": cs.isoformat() if cs else "",
                "end_date": ce.isoformat() if ce else "",
                "hours_per_day": float(c.get("HoursPerDay") or 8.0),
                "status_label": c.get("EventType") or "Scheduled",
                "status_light": "blue",
                "notes": c.get("Notes") or "",
            }
        )

    return {"auditors": auditors, "cbs": cbs, "events": events}


@agenda_router.post("/api/agenda/events")
async def create_agenda_event(payload: Dict[str, Any], request: Request):
    user = _require_user(request)
    title = (payload.get("Title") or "").strip()
    event_type = (payload.get("EventType") or "Other").strip()
    start_d = _to_date(payload.get("StartDate"))
    end_d = _to_date(payload.get("EndDate")) or start_d
    if not title or not start_d:
        raise HTTPException(status_code=400, detail="Title and StartDate are required.")
    if end_d < start_d:
        end_d = start_d

    auditor_id = payload.get("AuditorID")
    auditor_id = int(auditor_id) if auditor_id not in (None, "", "null") else None
    hours = float(payload.get("HoursPerDay") or 8.0)
    notes = (payload.get("Notes") or "").strip() or None

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            INSERT INTO dbo.tbl_Agenda_Events (AuditorID, EventType, Title, StartDate, EndDate, HoursPerDay, Notes, CreatedBy)
            OUTPUT INSERTED.ID
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (auditor_id, event_type, title, start_d, end_d, hours, notes, user.get("username", "Admin")),
        )
        new_id = int(cur.fetchone()[0])
        conn.commit()
        return {"success": True, "id": new_id}
    finally:
        cur.close()
        conn.close()


@agenda_router.put("/api/agenda/events/{event_id}")
async def update_agenda_event(event_id: int, payload: Dict[str, Any], request: Request):
    _require_user(request)
    title = (payload.get("Title") or "").strip()
    event_type = (payload.get("EventType") or "Other").strip()
    start_d = _to_date(payload.get("StartDate"))
    end_d = _to_date(payload.get("EndDate")) or start_d
    if not title or not start_d:
        raise HTTPException(status_code=400, detail="Title and StartDate are required.")
    if end_d < start_d:
        end_d = start_d

    auditor_id = payload.get("AuditorID")
    auditor_id = int(auditor_id) if auditor_id not in (None, "", "null") else None
    hours = float(payload.get("HoursPerDay") or 8.0)
    notes = (payload.get("Notes") or "").strip() or None

    execute_query(
        """
        UPDATE dbo.tbl_Agenda_Events
        SET AuditorID = ?, EventType = ?, Title = ?, StartDate = ?, EndDate = ?, HoursPerDay = ?, Notes = ?
        WHERE ID = ?
        """,
        (auditor_id, event_type, title, start_d, end_d, hours, notes, event_id),
    )
    return {"success": True, "id": event_id}


@agenda_router.delete("/api/agenda/events/{event_id}")
async def delete_agenda_event(event_id: int, request: Request):
    _require_user(request)
    execute_query("DELETE FROM dbo.tbl_Agenda_Events WHERE ID = ?", (event_id,))
    return {"success": True}


@agenda_router.get("/api/agenda/availability")
async def check_auditor_availability(
    request: Request,
    start: str,
    end: str,
    exclude_wfid: Optional[int] = None,
):
    _require_user(request)
    start_d = _to_date(start)
    end_d = _to_date(end)
    if not start_d or not end_d:
        raise HTTPException(status_code=400, detail="Valid start and end dates are required.")
    if end_d < start_d:
        end_d = start_d

    events = _build_audit_and_report_entries(start_d, end_d)
    custom_rows = execute_query(
        """
        SELECT ID, AuditorID, EventType, Title, StartDate, EndDate
        FROM dbo.tbl_Agenda_Events
        WHERE StartDate <= ? AND EndDate >= ?
        """,
        (end_d.strftime("%Y-%m-%d"), start_d.strftime("%Y-%m-%d")),
    )

    conflicts: Dict[str, List[Dict[str, Any]]] = {}

    def add_conflict(aid: Optional[int], item: Dict[str, Any]):
        if aid is None:
            return
        key = str(aid)
        conflicts.setdefault(key, []).append(item)

    for ev in events:
        if exclude_wfid and ev.get("wfid") == exclude_wfid:
            continue
        add_conflict(
            ev["auditor_id"],
            {
                "kind": ev["kind"],
                "title": ev["title"],
                "start_date": ev["start_date"],
                "end_date": ev["end_date"],
                "status_label": ev["status_label"],
            },
        )

    for c in custom_rows:
        if c.get("AuditorID") is None:
            continue
        cs = _to_date(c.get("StartDate"))
        ce = _to_date(c.get("EndDate")) or cs
        add_conflict(
            int(c["AuditorID"]),
            {
                "kind": c.get("EventType") or "Event",
                "title": c.get("Title") or c.get("EventType") or "Event",
                "start_date": cs.isoformat() if cs else "",
                "end_date": ce.isoformat() if ce else "",
                "status_label": c.get("EventType") or "Booked",
            },
        )

    return {"start": start_d.isoformat(), "end": end_d.isoformat(), "conflicts": conflicts}


@agenda_router.get("/api/timesheets")
async def get_timesheets(
    request: Request,
    start: str,
    end: str,
    auditor_id: Optional[int] = None,
    cb_id: Optional[int] = None,
):
    _require_user(request)
    start_d = _to_date(start)
    end_d = _to_date(end)
    if not start_d or not end_d:
        raise HTTPException(status_code=400, detail="Valid start and end dates are required.")

    where_clauses = ["t.EntryDate >= ?", "t.EntryDate <= ?"]
    params: List[Any] = [start_d.strftime("%Y-%m-%d"), end_d.strftime("%Y-%m-%d")]
    if auditor_id:
        where_clauses.append("t.AuditorID = ?")
        params.append(auditor_id)
    if cb_id:
        where_clauses.append("t.CBID = ?")
        params.append(cb_id)

    entries = execute_query(
        f"""
        SELECT t.*,
               LTRIM(RTRIM(COALESCE(a.First_Name, '') + ' ' + COALESCE(a.Last_Name, ''))) AS AuditorName,
               cb.Company_Name AS CB_Name,
               wf.Project_Nr,
               aud.Company_Name AS Auditee_Name
        FROM dbo.tbl_Timesheets t
        LEFT JOIN dbo.tbl_Auditors a ON t.AuditorID = a.AuditorID
        LEFT JOIN dbo.tbl_Certification_Bodies cb ON t.CBID = cb.ID
        LEFT JOIN dbo.tbl_WorkflowProcess wf ON t.WFID = wf.WFID
        LEFT JOIN dbo.tbl_Auditees aud ON wf.AuditeeID = aud.ID
        WHERE {' AND '.join(where_clauses)}
        ORDER BY t.EntryDate DESC, t.ID DESC
        """,
        tuple(params),
    )
    for e in entries:
        ed = _to_date(e.get("EntryDate"))
        e["EntryDate"] = ed.isoformat() if ed else ""
        e["Hours"] = float(e.get("Hours") or 0)

    # Also build allocated hours summary from workflows & costings in the same period
    wf_events = _build_audit_and_report_entries(start_d, end_d, auditor_id=auditor_id)
    allocated: List[Dict[str, Any]] = []
    wf_cost_cache: Dict[int, List[Dict[str, Any]]] = {}

    for ev in wf_events:
        meta = ev.get("meta") or {}
        if cb_id and meta.get("cb_id") != cb_id:
            continue
        wfid = ev["wfid"]
        if wfid not in wf_cost_cache:
            wf_cost_cache[wfid] = execute_query(
                "SELECT OrdBy, Aud1, Aud2, Aud3 FROM dbo.tbl_WF_AuditorCostings WHERE WFID = ? AND OrdBy IN (10, 30, 110, 120, 130)",
                (wfid,),
            )
        cost_rows = {int(c["OrdBy"]): c for c in wf_cost_cache[wfid] if c.get("OrdBy") is not None}
        col = {"Auditor1": "Aud1", "Auditor2": "Aud2", "Auditor3": "Aud3"}.get(ev.get("role"), "Aud1")

        if ev["kind"] == "audit":
            mandays = float((cost_rows.get(10) or {}).get(col) or meta.get("audit_days") or 1.0)
            sched_hrs = round(mandays * 8.0, 2)
            # Travel time hours from costing (OrdBy 130 override, else 110 est driving hrs)
            ov_tt = float((cost_rows.get(130) or {}).get(col) or 0)
            est_tt = float((cost_rows.get(110) or {}).get(col) or 0)
            travel_hrs = round(ov_tt if ov_tt > 0 else est_tt, 2)
        else:
            sched_hrs = 4.0
            travel_hrs = 0.0

        allocated.append(
            {
                "wfid": wfid,
                "auditor_id": ev["auditor_id"],
                "cb_id": meta.get("cb_id"),
                "cb_name": meta.get("cb_name") or "Unassigned CB",
                "project_nr": meta.get("project_nr"),
                "auditee": meta.get("auditee"),
                "category": "Audit" if ev["kind"] == "audit" else "Report Writing",
                "start_date": ev["start_date"],
                "end_date": ev["end_date"],
                "scheduled_hours": sched_hrs,
                "travel_hours": travel_hrs,
            }
        )

    return {"entries": entries, "allocated": allocated}


@agenda_router.post("/api/timesheets")
async def create_timesheet_entry(payload: Dict[str, Any], request: Request):
    user = _require_user(request)
    auditor_id = payload.get("AuditorID")
    entry_date = _to_date(payload.get("EntryDate"))
    hours = float(payload.get("Hours") or 0)
    if not auditor_id or not entry_date or hours <= 0:
        raise HTTPException(status_code=400, detail="AuditorID, EntryDate, and positive Hours are required.")

    wfid = int(payload["WFID"]) if payload.get("WFID") not in (None, "", "null") else None
    cbid = int(payload["CBID"]) if payload.get("CBID") not in (None, "", "null") else None
    category = (payload.get("Category") or "Audit").strip()
    billable = 1 if payload.get("Billable", True) else 0
    status = (payload.get("Status") or "Submitted").strip()
    desc = (payload.get("Description") or "").strip() or None

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            INSERT INTO dbo.tbl_Timesheets (AuditorID, WFID, CBID, Category, EntryDate, Hours, Billable, Status, Description, CreatedBy)
            OUTPUT INSERTED.ID
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (int(auditor_id), wfid, cbid, category, entry_date, hours, billable, status, desc, user.get("username", "Admin")),
        )
        new_id = int(cur.fetchone()[0])
        conn.commit()
        return {"success": True, "id": new_id}
    finally:
        cur.close()
        conn.close()


@agenda_router.post("/api/timesheets/sync-from-costings")
async def sync_timesheets_from_costings(payload: Dict[str, Any], request: Request):
    """Generates timesheet entries from allocated workflow costings in the selected period if not already logged."""
    user = _require_user(request)
    start_d = _to_date(payload.get("start"))
    end_d = _to_date(payload.get("end"))
    auditor_id = int(payload["auditor_id"]) if payload.get("auditor_id") not in (None, "", "null") else None
    cb_id = int(payload["cb_id"]) if payload.get("cb_id") not in (None, "", "null") else None
    if not start_d or not end_d:
        raise HTTPException(status_code=400, detail="Valid start and end dates are required.")

    wf_events = _build_audit_and_report_entries(start_d, end_d, auditor_id=auditor_id)
    existing = execute_query(
        "SELECT AuditorID, WFID, Category FROM dbo.tbl_Timesheets WHERE EntryDate >= ? AND EntryDate <= ?",
        (start_d.strftime("%Y-%m-%d"), end_d.strftime("%Y-%m-%d")),
    )
    existing_keys = {(int(r["AuditorID"]), r.get("WFID"), r.get("Category")) for r in existing}

    created = 0
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        for ev in wf_events:
            meta = ev.get("meta") or {}
            if cb_id and meta.get("cb_id") != cb_id:
                continue
            wfid = ev["wfid"]
            aid = int(ev["auditor_id"])
            cost_rows = execute_query(
                "SELECT OrdBy, Aud1, Aud2, Aud3 FROM dbo.tbl_WF_AuditorCostings WHERE WFID = ? AND OrdBy IN (10, 110, 130)",
                (wfid,),
            )
            cmap = {int(c["OrdBy"]): c for c in cost_rows if c.get("OrdBy") is not None}
            col = {"Auditor1": "Aud1", "Auditor2": "Aud2", "Auditor3": "Aud3"}.get(ev.get("role"), "Aud1")

            if ev["kind"] == "audit":
                mandays = float((cmap.get(10) or {}).get(col) or meta.get("audit_days") or 1.0)
                hrs = round(mandays * 8.0, 2)
                if (aid, wfid, "Audit") not in existing_keys and hrs > 0:
                    cur.execute(
                        """
                        INSERT INTO dbo.tbl_Timesheets (AuditorID, WFID, CBID, Category, EntryDate, Hours, Billable, Status, Description, CreatedBy)
                        VALUES (?, ?, ?, 'Audit', ?, ?, 1, 'Submitted', ?, ?)
                        """,
                        (aid, wfid, meta.get("cb_id"), ev["start_date"], hrs, f"{meta.get('auditee')} ({meta.get('project_nr')})", user.get("username", "Admin")),
                    )
                    existing_keys.add((aid, wfid, "Audit"))
                    created += 1

                ov_tt = float((cmap.get(130) or {}).get(col) or 0)
                est_tt = float((cmap.get(110) or {}).get(col) or 0)
                tt_hrs = round(ov_tt if ov_tt > 0 else est_tt, 2)
                if tt_hrs > 0 and (aid, wfid, "Travel") not in existing_keys:
                    cur.execute(
                        """
                        INSERT INTO dbo.tbl_Timesheets (AuditorID, WFID, CBID, Category, EntryDate, Hours, Billable, Status, Description, CreatedBy)
                        VALUES (?, ?, ?, 'Travel', ?, ?, 1, 'Submitted', ?, ?)
                        """,
                        (aid, wfid, meta.get("cb_id"), ev["start_date"], tt_hrs, f"Travel: {meta.get('auditee')} ({meta.get('project_nr')})", user.get("username", "Admin")),
                    )
                    existing_keys.add((aid, wfid, "Travel"))
                    created += 1
            elif ev["kind"] == "report":
                if (aid, wfid, "Report Writing") not in existing_keys:
                    cur.execute(
                        """
                        INSERT INTO dbo.tbl_Timesheets (AuditorID, WFID, CBID, Category, EntryDate, Hours, Billable, Status, Description, CreatedBy)
                        VALUES (?, ?, ?, 'Report Writing', ?, 4.0, 1, 'Submitted', ?, ?)
                        """,
                        (aid, wfid, meta.get("cb_id"), ev["start_date"], f"Report: {meta.get('auditee')} ({meta.get('project_nr')})", user.get("username", "Admin")),
                    )
                    existing_keys.add((aid, wfid, "Report Writing"))
                    created += 1
        conn.commit()
        return {"success": True, "created": created}
    finally:
        cur.close()
        conn.close()


@agenda_router.patch("/api/timesheets/{ts_id}/status")
async def update_timesheet_status(ts_id: int, payload: Dict[str, Any], request: Request):
    _require_user(request)
    status = (payload.get("Status") or "").strip()
    if status not in ("Draft", "Submitted", "Approved", "Rejected"):
        raise HTTPException(status_code=400, detail="Invalid status")
    execute_query("UPDATE dbo.tbl_Timesheets SET Status = ? WHERE ID = ?", (status, ts_id))
    return {"success": True}


@agenda_router.delete("/api/timesheets/{ts_id}")
async def delete_timesheet_entry(ts_id: int, request: Request):
    _require_user(request)
    execute_query("DELETE FROM dbo.tbl_Timesheets WHERE ID = ?", (ts_id,))
    return {"success": True}
