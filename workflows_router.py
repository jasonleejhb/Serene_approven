import json
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import pyodbc
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from db_config import DB_CONN_STR

workflows_router = APIRouter()


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
        return None
    finally:
        cursor.close()
        conn.close()


def _require_user(request: Request) -> dict:
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return user


def _get_google_maps_api_key() -> str:
    """Decrypts the Google Maps API key from dbo.tbl_Keys."""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("OPEN SYMMETRIC KEY ApprovenSymmetricKey DECRYPTION BY CERTIFICATE ApprovenKeyCert;")
        row = cur.execute(
            "SELECT CONVERT(NVARCHAR(MAX), DECRYPTBYKEY([Key])) FROM dbo.tbl_Keys WHERE Description = N'Google Maps API'"
        ).fetchone()
        cur.execute("CLOSE SYMMETRIC KEY ApprovenSymmetricKey;")
        if not row or not row[0]:
            raise HTTPException(status_code=500, detail="Google Maps API key not found in tbl_Keys.")
        return row[0]
    finally:
        cur.close()
        conn.close()


def _resolve_rates(cb_id: Optional[int], program: Optional[str], site_id: Optional[int]) -> Dict[str, Any]:
    """Resolves Manday, Report, Driving, Hotel, Dinner, and Lunch rates with source metadata."""
    # System defaults
    defaults = {}
    for r in execute_query("SELECT Description, Rate FROM dbo.tbl_AuditCosts"):
        defaults[r["Description"]] = float(r["Rate"] or 0)

    def_manday_map = {}
    for r in execute_query("SELECT Charge, Default_Rate FROM dbo.tbl_DefaultMandayReport"):
        def_manday_map[r["Charge"]] = float(r["Default_Rate"] or 0)

    manday_rate = def_manday_map.get("Manday Rate", 700.0)
    manday_src = "System default"
    report_fee = def_manday_map.get("Report Writing", 350.0)
    report_src = "System default"
    per_km_rate = defaults.get("Road Travel Cost", 0.60)
    km_src = "System default"
    hotel_rate = 150.0
    hotel_src = "System default"
    dinner_rate = defaults.get("Dinner", 60.0)
    dinner_src = "System default"
    lunch_rate = defaults.get("Lunches", 10.0)
    avg_speed = defaults.get("Average Driving Speed", 64.0)
    hotel_km_threshold = defaults.get("KMs of Road Travel where Hotel is Required (one-way)", 100.0)
    default_valid_days = int(defaults.get("Default Quote Valid Period", 14) or 14)

    if cb_id:
        cb_rows = execute_query(
            "SELECT Man_Day_Rate, Per_KM_Rate, Travel_Time_Rate_perHour, Hotel_perNight_Rate, Report_Fee FROM dbo.tbl_Certification_Bodies WHERE ID = ?",
            (cb_id,),
        )
        if cb_rows:
            cb = cb_rows[0]
            if cb.get("Man_Day_Rate") and float(cb["Man_Day_Rate"]) > 0:
                manday_rate = float(cb["Man_Day_Rate"])
                manday_src = "CB default"
            if cb.get("Report_Fee") and float(cb["Report_Fee"]) > 0:
                report_fee = float(cb["Report_Fee"])
                report_src = "CB default"
            if cb.get("Per_KM_Rate") and float(cb["Per_KM_Rate"]) > 0:
                per_km_rate = float(cb["Per_KM_Rate"])
                km_src = "CB default"
            if cb.get("Hotel_perNight_Rate") and float(cb["Hotel_perNight_Rate"]) > 0:
                hotel_rate = float(cb["Hotel_perNight_Rate"])
                hotel_src = "CB default"

        if program:
            prog_rows = execute_query(
                "SELECT Manday_Rate, Report_Percentage FROM dbo.tbl_CertBod_Programs WHERE CBID = ? AND Program = ?",
                (cb_id, program),
            )
            if prog_rows:
                pr = prog_rows[0]
                if pr.get("Manday_Rate") and float(pr["Manday_Rate"]) > 0:
                    manday_rate = float(pr["Manday_Rate"])
                    manday_src = f"CB Program ({program})"
                if pr.get("Report_Percentage") and float(pr["Report_Percentage"]) > 0:
                    pct = float(pr["Report_Percentage"])
                    report_fee = round(manday_rate * (pct / 100.0 if pct > 2 else pct), 2)
                    report_src = f"CB Program ({program})"

    if site_id:
        site_rows = execute_query("SELECT Country FROM dbo.tbl_AuditeeSites WHERE ID = ?", (site_id,))
        if site_rows and site_rows[0].get("Country"):
            country = site_rows[0]["Country"].strip()
            hr = execute_query("SELECT TOP 1 Rate_perNight FROM dbo.tbl_HotelRates WHERE Country = ? ORDER BY ID DESC", (country,))
            if hr and hr[0].get("Rate_perNight"):
                hotel_rate = float(hr[0]["Rate_perNight"])
                hotel_src = f"Country rate ({country})"
            dr = execute_query("SELECT TOP 1 Rate_perNight FROM dbo.tbl_DinnerRates WHERE Country = ? ORDER BY ID DESC", (country,))
            if dr and dr[0].get("Rate_perNight"):
                dinner_rate = float(dr[0]["Rate_perNight"])
                dinner_src = f"Country rate ({country})"

    return {
        "manday_rate": round(manday_rate, 2),
        "manday_hour_rate": round(manday_rate / 8.0, 2),
        "report_fee": round(report_fee, 2),
        "per_km_rate": round(per_km_rate, 2),
        "avg_speed": round(avg_speed, 2),
        "hotel_rate": round(hotel_rate, 2),
        "dinner_rate": round(dinner_rate, 2),
        "lunch_rate": round(lunch_rate, 2),
        "hotel_km_threshold": round(hotel_km_threshold, 2),
        "default_valid_days": default_valid_days,
        "sources": {
            "manday": manday_src,
            "report": report_src,
            "per_km": km_src,
            "hotel": hotel_src,
            "dinner": dinner_src,
        },
    }


def _fetch_template_costings() -> List[Dict[str, Any]]:
    rows = execute_query(
        "SELECT Ordby AS OrdBy, Description, Link_toTravel, LinkedCharge, TotalCalc, DataEntry, SysComments AS Comments FROM dbo.tbl_AuditorCosts_Template ORDER BY Ordby"
    )
    for r in rows:
        r["Aud1"] = None
        r["Aud2"] = None
        r["Aud3"] = None
        r["OtherCharge_Amount"] = None
        r["OtherCharges"] = False
        r["Override"] = False
        r["FromTemplate"] = True
    return rows


@workflows_router.get("/api/workflows/lookups")
async def get_workflow_lookups(request: Request):
    _require_user(request)
    cbs = execute_query(
        "SELECT ID, Company_Name, Man_Day_Rate, Per_KM_Rate, Hotel_perNight_Rate, Report_Fee FROM dbo.tbl_Certification_Bodies WHERE Status = 'Active' OR Status IS NULL ORDER BY Company_Name"
    )
    auditees = execute_query(
        "SELECT ID, Company_Name, Country FROM dbo.tbl_Auditees WHERE Status = 'Active' OR Status IS NULL ORDER BY Company_Name"
    )
    sites = execute_query(
        "SELECT ID, AuditeeID, SiteName, Address, Country FROM dbo.tbl_AuditeeSites ORDER BY SiteName"
    )
    programs = [
        r["Program"]
        for r in execute_query("SELECT Program FROM dbo.tbl_AuditPrograms WHERE Program IS NOT NULL ORDER BY Program")
    ]
    auditors = execute_query(
        "SELECT AuditorID, First_Name, Last_Name, Status, Residence_City, Residence_Country, Internal_Onboarding_Complete FROM dbo.tbl_Auditors ORDER BY First_Name, Last_Name"
    )
    db_types = [
        r["Audit_Type"]
        for r in execute_query("SELECT DISTINCT Audit_Type FROM dbo.tbl_WorkflowProcess WHERE Audit_Type IS NOT NULL AND LTRIM(RTRIM(Audit_Type)) <> ''")
    ]
    standard_types = ["Initial Audit", "Periodic Audit", "Follow-up", "Partial Follow-up", "Desktop Audit", "Transfer Audit", "Surveillance", "Re-certification"]
    audit_types = sorted(set(db_types + standard_types))
    product_codes = execute_query(
        "SELECT ID, Code, Omschrijving, Tegenrekening, BTW FROM dbo.tbl_ProductCodes ORDER BY Code"
    )
    return {
        "certification_bodies": cbs,
        "auditees": auditees,
        "sites": sites,
        "programs": programs,
        "auditors": auditors,
        "audit_types": audit_types,
        "announcements": ["Announced", "Semi-Announced", "Unannounced"],
        "product_codes": product_codes,
        "costing_template": _fetch_template_costings(),
    }


@workflows_router.get("/api/workflows/rates")
async def get_workflow_rates(
    request: Request,
    cb_id: Optional[int] = None,
    program: Optional[str] = None,
    site_id: Optional[int] = None,
):
    _require_user(request)
    return _resolve_rates(cb_id, program, site_id)


class DistanceCalcRequest(BaseModel):
    wfid: Optional[int] = None
    cb_id: Optional[int] = None
    program: Optional[str] = None
    site_id: int


@workflows_router.post("/api/workflows/calculate-distances")
async def calculate_auditor_distances(payload: DistanceCalcRequest, request: Request):
    _require_user(request)

    site_rows = execute_query(
        "SELECT ID, SiteName, Address, Country FROM dbo.tbl_AuditeeSites WHERE ID = ?",
        (payload.site_id,),
    )
    if not site_rows:
        raise HTTPException(status_code=404, detail="Selected site not found.")
    site = site_rows[0]
    dest_parts = [p.strip() for p in [site.get("Address"), site.get("Country")] if p and str(p).strip()]
    if not dest_parts:
        raise HTTPException(status_code=400, detail="Selected site has no address or country configured.")
    destination = ", ".join(dest_parts)

    api_key = _get_google_maps_api_key()

    auditors = execute_query(
        """
        SELECT AuditorID, First_Name, Last_Name, Status,
               Residence_Address, Residence_City, Residence_Country,
               Internal_Onboarding_Complete
        FROM dbo.tbl_Auditors
        WHERE Status = 'Active' OR Status IS NULL
        ORDER BY First_Name, Last_Name
        """
    )

    cb_onboarded_set = set()
    prog_onboarded_set = set()
    if payload.cb_id:
        for r in execute_query(
            "SELECT AuditorID, Status FROM dbo.tbl_Auditors_CBs_Onboarded WHERE CB = ?",
            (payload.cb_id,),
        ):
            if (r.get("Status") or "").strip().lower() in ("yes", "active", "onboarded", "complete", "completed", "1", "true"):
                cb_onboarded_set.add(r["AuditorID"])
        if payload.program:
            for r in execute_query(
                "SELECT AuditorID, Status FROM dbo.tbl_Auditor_Programs WHERE CertificationBody = ? AND Program = ?",
                (payload.cb_id, payload.program),
            ):
                if (r.get("Status") or "").strip().lower() in ("yes", "active", "onboarded", "compliant", "complete", "completed", "valid", "1", "true"):
                    prog_onboarded_set.add(r["AuditorID"])

    existing_map: Dict[int, Dict[str, Any]] = {}
    if payload.wfid:
        for r in execute_query(
            "SELECT AuditorID, SelectAud, WillDrive FROM dbo.tbl_Workflow_Distances WHERE WFID = ?",
            (payload.wfid,),
        ):
            existing_map[r["AuditorID"]] = r

    # Prepare origins for Google Maps Distance Matrix API (batches of 25)
    origins_meta = []
    for a in auditors:
        addr_parts = [
            str(p).strip()
            for p in [a.get("Residence_Address"), a.get("Residence_City"), a.get("Residence_Country")]
            if p and str(p).strip()
        ]
        if addr_parts:
            origins_meta.append((a["AuditorID"], ", ".join(addr_parts)))

    distance_results: Dict[int, Optional[float]] = {}
    batch_size = 25
    for i in range(0, len(origins_meta), batch_size):
        batch = origins_meta[i : i + batch_size]
        origins_param = "|".join(addr for _, addr in batch)
        qs = urllib.parse.urlencode(
            {
                "origins": origins_param,
                "destinations": destination,
                "mode": "driving",
                "units": "metric",
                "key": api_key,
            }
        )
        url = f"https://maps.googleapis.com/maps/api/distancematrix/json?{qs}"
        try:
            with urllib.request.urlopen(url, timeout=15) as resp:
                gm_data = json.loads(resp.read().decode("utf-8"))
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Google Maps API request failed: {exc}")

        if gm_data.get("status") not in ("OK", None):
            err_msg = gm_data.get("error_message") or gm_data.get("status")
            raise HTTPException(status_code=502, detail=f"Google Maps API error: {err_msg}")

        rows = gm_data.get("rows") or []
        for idx, (aud_id, _) in enumerate(batch):
            dist_km = None
            if idx < len(rows):
                elements = rows[idx].get("elements") or []
                if elements and elements[0].get("status") == "OK":
                    meters = elements[0]["distance"]["value"]
                    dist_km = round(meters / 1000.0)
            distance_results[aud_id] = dist_km

    output_rows = []
    for a in auditors:
        aid = a["AuditorID"]
        full_name = f"{a.get('First_Name') or ''} {a.get('Last_Name') or ''}".strip()
        internal_yes = bool(a.get("Internal_Onboarding_Complete"))
        if payload.cb_id and payload.program:
            cb_prog_yes = (aid in cb_onboarded_set) and (aid in prog_onboarded_set)
        elif payload.cb_id:
            cb_prog_yes = aid in cb_onboarded_set
        else:
            cb_prog_yes = False

        prev = existing_map.get(aid, {})
        dist_km = distance_results.get(aid)
        output_rows.append(
            {
                "AuditorID": aid,
                "Auditor": full_name,
                "City": a.get("Residence_City") or "",
                "Country": a.get("Residence_Country") or "",
                "InternalOnboarded": "YES" if internal_yes else "",
                "CB_Prog_Onboarded": "YES" if cb_prog_yes else "",
                "CanSelect": internal_yes and cb_prog_yes,
                "Distance": dist_km,
                "SelectAud": prev.get("SelectAud") or "",
                "WillDrive": bool(prev.get("WillDrive")) if prev else False,
            }
        )

    output_rows.sort(
        key=lambda r: (
            0 if r["CanSelect"] else 1,
            r["Distance"] if r["Distance"] is not None else 999999,
            r["Auditor"].lower(),
        )
    )

    if payload.wfid:
        conn = get_db_connection()
        cur = conn.cursor()
        try:
            cur.execute("DELETE FROM dbo.tbl_Workflow_Distances WHERE WFID = ?", (payload.wfid,))
            for r in output_rows:
                cur.execute(
                    """
                    INSERT INTO dbo.tbl_Workflow_Distances
                        (AuditorID, WFID, Auditor, City, Country, Distance, SelectAud, InternalOnboarded, CB_Prog_Onboarded, WillDrive)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        r["AuditorID"],
                        payload.wfid,
                        r["Auditor"],
                        r["City"],
                        r["Country"],
                        r["Distance"],
                        r["SelectAud"] or None,
                        r["InternalOnboarded"] or None,
                        r["CB_Prog_Onboarded"] or None,
                        1 if r["WillDrive"] else 0,
                    ),
                )
            conn.commit()
        finally:
            cur.close()
            conn.close()

    return {"destination": destination, "distances": output_rows}


@workflows_router.get("/api/workflows/{wfid}")
async def get_workflow_detail(wfid: int, request: Request):
    _require_user(request)
    wf_rows = execute_query("SELECT * FROM dbo.tbl_WorkflowProcess WHERE WFID = ?", (wfid,))
    if not wf_rows:
        raise HTTPException(status_code=404, detail="Workflow not found")
    wf = wf_rows[0]

    distances = execute_query(
        "SELECT * FROM dbo.tbl_Workflow_Distances WHERE WFID = ? ORDER BY CASE WHEN Distance IS NULL THEN 1 ELSE 0 END, Distance ASC, Auditor ASC",
        (wfid,),
    )
    for d in distances:
        d["CanSelect"] = (d.get("InternalOnboarded") == "YES") and (d.get("CB_Prog_Onboarded") == "YES")

    costings = execute_query(
        "SELECT * FROM dbo.tbl_WF_AuditorCostings WHERE WFID = ? ORDER BY OrdBy ASC, ID ASC",
        (wfid,),
    )
    if not costings:
        costings = _fetch_template_costings()

    quote_rows = execute_query("SELECT TOP 1 * FROM dbo.tbl_Quoting WHERE WFID = ? ORDER BY QuoteID DESC", (wfid,))
    quote = quote_rows[0] if quote_rows else None
    quote_transactions = execute_query(
        "SELECT * FROM dbo.tbl_Quote_Transactions WHERE WFID = ? ORDER BY [Order] ASC, ID ASC",
        (wfid,),
    )

    follow_ups = execute_query("SELECT * FROM dbo.tbl_FollowUps_Desktops WHERE WFID = ?", (wfid,))
    rates = _resolve_rates(wf.get("Certification_Body"), wf.get("Audit_Program"), wf.get("SiteID"))

    return {
        "workflow": wf,
        "distances": distances,
        "costings": costings,
        "quote": quote,
        "quote_transactions": quote_transactions,
        "follow_ups": follow_ups,
        "rates": rates,
    }


def _save_workflow_children(conn, wfid: int, data: Dict[str, Any]):
    cur = conn.cursor()
    if "distances" in data and data["distances"] is not None:
        cur.execute("DELETE FROM dbo.tbl_Workflow_Distances WHERE WFID = ?", (wfid,))
        for d in data["distances"]:
            cur.execute(
                """
                INSERT INTO dbo.tbl_Workflow_Distances
                    (AuditorID, WFID, Auditor, City, Country, Distance, SelectAud, InternalOnboarded, CB_Prog_Onboarded, WillDrive)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    d.get("AuditorID"),
                    wfid,
                    d.get("Auditor"),
                    d.get("City"),
                    d.get("Country"),
                    d.get("Distance"),
                    d.get("SelectAud") or None,
                    d.get("InternalOnboarded") or None,
                    d.get("CB_Prog_Onboarded") or None,
                    1 if d.get("WillDrive") else 0,
                ),
            )

    if "costings" in data and data["costings"] is not None:
        cur.execute("DELETE FROM dbo.tbl_WF_AuditorCostings WHERE WFID = ?", (wfid,))
        for c in data["costings"]:
            cur.execute(
                """
                INSERT INTO dbo.tbl_WF_AuditorCostings
                    (WFID, OrdBy, Description, Aud1, Aud2, Aud3, Comments, Link_toTravel, LinkedCharge,
                     Not_PO1, Not_PO2, Not_PO3, TotalCalc, DataEntry, Override, OtherCharges, OtherCharge_Amount, FromTemplate)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    wfid,
                    c.get("OrdBy"),
                    c.get("Description"),
                    c.get("Aud1"),
                    c.get("Aud2"),
                    c.get("Aud3"),
                    c.get("Comments"),
                    1 if c.get("Link_toTravel") else 0,
                    1 if c.get("LinkedCharge") else 0,
                    1 if c.get("Not_PO1") else 0,
                    1 if c.get("Not_PO2") else 0,
                    1 if c.get("Not_PO3") else 0,
                    1 if c.get("TotalCalc") else 0,
                    1 if c.get("DataEntry") else 0,
                    1 if c.get("Override") else 0,
                    1 if c.get("OtherCharges") else 0,
                    c.get("OtherCharge_Amount"),
                    1 if c.get("FromTemplate", True) else 0,
                ),
            )

    quote_id = None
    if "quote" in data and data["quote"] is not None:
        q = data["quote"]
        wf = data.get("workflow") or {}
        existing_q = cur.execute("SELECT TOP 1 QuoteID FROM dbo.tbl_Quoting WHERE WFID = ? ORDER BY QuoteID DESC", (wfid,)).fetchone()
        if existing_q:
            quote_id = existing_q[0]
            cur.execute(
                """
                UPDATE dbo.tbl_Quoting
                SET QuoteRef = ?, Reference = ?, PO_Number = ?, CB = ?, AuditeeID = ?,
                    Quote_ValidTo = ?, Quote_SubTotal = ?, Quote_VAT = ?, Quote_Total = ?,
                    Quote_Status = ?, Date_Submitted = ?, Outcome_Date = ?,
                    Discount = ?, Disc_Amount = ?, Comments = ?, Decline_Reason = ?
                WHERE QuoteID = ?
                """,
                (
                    q.get("QuoteRef"),
                    q.get("Reference"),
                    q.get("PO_Number"),
                    wf.get("Certification_Body") or q.get("CB"),
                    wf.get("AuditeeID") or q.get("AuditeeID"),
                    q.get("Quote_ValidTo") or None,
                    q.get("Quote_SubTotal"),
                    q.get("Quote_VAT"),
                    q.get("Quote_Total"),
                    q.get("Quote_Status") or "Preparing",
                    q.get("Date_Submitted") or None,
                    q.get("Outcome_Date") or None,
                    q.get("Discount"),
                    q.get("Disc_Amount"),
                    q.get("Comments"),
                    q.get("Decline_Reason"),
                    quote_id,
                ),
            )
        else:
            cur.execute(
                """
                INSERT INTO dbo.tbl_Quoting
                    (WFID, QuoteRef, Reference, PO_Number, CB, AuditeeID, [User], Quote_Created,
                     Quote_ValidTo, Quote_SubTotal, Quote_VAT, Quote_Total, Quote_Status,
                     Date_Submitted, Outcome_Date, Discount, Disc_Amount, Comments, Decline_Reason)
                OUTPUT INSERTED.QuoteID
                VALUES (?, ?, ?, ?, ?, ?, ?, GETDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    wfid,
                    q.get("QuoteRef"),
                    q.get("Reference"),
                    q.get("PO_Number"),
                    wf.get("Certification_Body") or q.get("CB"),
                    wf.get("AuditeeID") or q.get("AuditeeID"),
                    q.get("User"),
                    q.get("Quote_ValidTo") or None,
                    q.get("Quote_SubTotal"),
                    q.get("Quote_VAT"),
                    q.get("Quote_Total"),
                    q.get("Quote_Status") or "Preparing",
                    q.get("Date_Submitted") or None,
                    q.get("Outcome_Date") or None,
                    q.get("Discount"),
                    q.get("Disc_Amount"),
                    q.get("Comments"),
                    q.get("Decline_Reason"),
                ),
            )
            quote_id = int(cur.fetchone()[0])

    if "quote_transactions" in data and data["quote_transactions"] is not None:
        cur.execute("DELETE FROM dbo.tbl_Quote_Transactions WHERE WFID = ?", (wfid,))
        for idx, t in enumerate(data["quote_transactions"], start=1):
            qty = float(t.get("Quantity") or 0)
            unit_price = float(t.get("Unit_Price") or 0)
            line_total = round(qty * unit_price, 2) if t.get("Line_Total") is None else float(t.get("Line_Total") or 0)
            vat_perc = float(t.get("Vat_Perc") or 0)
            vat_amt = round(line_total * (vat_perc / 100.0), 2)
            incl_vat = round(line_total + vat_amt, 2)
            cur.execute(
                """
                INSERT INTO dbo.tbl_Quote_Transactions
                    (QuoteID, WFID, [Order], Quantity, Unit, Category, Code, Tegenrekening,
                     Description, Unit_Price, Line_Total, Vat_Perc, Vat_Amount, Incl_VAT, OtherCharges)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    quote_id,
                    wfid,
                    t.get("Order") or idx * 10,
                    qty,
                    t.get("Unit"),
                    t.get("Category"),
                    t.get("Code"),
                    t.get("Tegenrekening"),
                    t.get("Description"),
                    unit_price,
                    line_total,
                    vat_perc,
                    vat_amt,
                    incl_vat,
                    1 if t.get("OtherCharges") else 0,
                ),
            )


WF_UPDATABLE_FIELDS = [
    "Status", "Certification_Body", "AuditeeID", "SiteID", "Project_Nr", "Audit_Confirmed",
    "Audit_Program", "Audit_Type", "Single_Multi_Prog", "Single_Multi_Site", "Announcement",
    "NonAnn_Window_Type", "NonAnn_Window_Period", "Announced_Type", "Audit_Deadline",
    "Audit_Start_Date", "Audit_End_Date", "Audit_Dates_Confirmed", "AuditWindow_From",
    "AuditWindow_To", "Audit_Days", "OneDayAudit", "AuditorsRequired", "Auditor1", "Auditor2", "Auditor3",
    "Witness_Auditor", "Translator1", "Translator2", "Total_Mandays", "Mandays_Required",
    "Nr_Sites", "Cost_NrEmployees", "Amount_Quoted", "Quote_NoAutoUpdate",
    "Cost_Total_Aud1", "Cost_Total_Aud2", "Cost_Total_Aud3", "Cost_Total_Other",
    "Cost_Total_All", "Cost_MandayRate_Day", "Cost_MandayRate_perHour", "Report_Fee",
    "Email_QuoteRequest_Details", "Quote_Addit_Comments", "Hide_AuditorName_Quote", "Link_Sharepoint", "Link_CertIQ",
    "Link_Certificate", "Link_FSSCPortal", "Invoiced", "Inv_Number", "Inv_Amount",
    "Purchase_Ord_Nr", "Cancelled_Reason", "FollowUp_AuditRequired", "FollowUp_DesktopRequired",
]


WF_REQUIRED_BIT_DEFAULTS = [
    "Audit_Confirmed", "Audit_Dates_Confirmed", "Agri_AH_HighRisk", "Cost_RoadTravel",
    "Quote_NoAutoUpdate", "Hide_AuditorName_Quote", "Default_Manday", "AudCosts_Calculated", "OneDayAudit",
    "Auditor1_Calendar", "Auditor2_Calendar", "Auditor3_Calendar",
    "Transl1_Calendar", "Transl2_Calendar", "Witness_Calendar", "Invoiced",
]


@workflows_router.post("/api/workflows")
async def create_workflow(payload: Dict[str, Any], request: Request):
    user = _require_user(request)
    wf = payload.get("workflow") or {}
    cols = ["Created_By", "Created_Date"]
    vals = [user.get("username", "Admin"), datetime.now()]
    for field in WF_UPDATABLE_FIELDS:
        if field in wf:
            cols.append(field)
            vals.append(wf[field] if wf[field] != "" else None)
    if "Status" not in cols:
        cols.append("Status")
        vals.append("Pending")
    for bit_col in WF_REQUIRED_BIT_DEFAULTS:
        if bit_col not in cols:
            cols.append(bit_col)
            vals.append(0)

    col_sql = ", ".join(f"[{c}]" for c in cols)
    ph_sql = ", ".join("?" for _ in cols)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(f"INSERT INTO dbo.tbl_WorkflowProcess ({col_sql}) OUTPUT INSERTED.WFID VALUES ({ph_sql})", tuple(vals))
        new_wfid = int(cur.fetchone()[0])
        if payload.get("quote") and not payload["quote"].get("User"):
            payload["quote"]["User"] = user.get("username", "Admin")
        _save_workflow_children(conn, new_wfid, payload)
        conn.commit()
        return {"success": True, "wfid": new_wfid}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@workflows_router.put("/api/workflows/{wfid}")
async def update_workflow(wfid: int, payload: Dict[str, Any], request: Request):
    user = _require_user(request)
    wf = payload.get("workflow") or {}
    sets = []
    vals = []
    for field in WF_UPDATABLE_FIELDS:
        if field in wf:
            sets.append(f"[{field}] = ?")
            vals.append(wf[field] if wf[field] != "" else None)

    if wf.get("Status") == "Cancelled":
        sets.append("[Cancelled_By] = ?")
        vals.append(user.get("username", "Admin"))
        sets.append("[Cancelled_Date] = GETDATE()")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        if sets:
            vals.append(wfid)
            cur.execute(f"UPDATE dbo.tbl_WorkflowProcess SET {', '.join(sets)} WHERE WFID = ?", tuple(vals))
        if payload.get("quote") and not payload["quote"].get("User"):
            payload["quote"]["User"] = user.get("username", "Admin")
        _save_workflow_children(conn, wfid, payload)
        conn.commit()
        return {"success": True, "wfid": wfid}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@workflows_router.get("/api/workflows/{wfid}/quote-preview", response_class=HTMLResponse)
async def preview_workflow_quote(wfid: int, request: Request, hide_auditors: Optional[int] = None):
    import html as _html
    _require_user(request)
    rows = execute_query(
        """
        SELECT wf.*,
               cb.Company_Name AS CB_Name, cb.Customer_Number, cb.Billing_Physical_Address,
               cb.Billing_Country, cb.Quote_Terms,
               aud.Company_Name AS Auditee_Name,
               s.SiteName, s.Address AS Site_Address, s.Country AS Site_Country,
               LTRIM(RTRIM(COALESCE(a1.First_Name, '') + ' ' + COALESCE(a1.Last_Name, ''))) AS Auditor1_Name,
               LTRIM(RTRIM(COALESCE(a2.First_Name, '') + ' ' + COALESCE(a2.Last_Name, ''))) AS Auditor2_Name,
               LTRIM(RTRIM(COALESCE(a3.First_Name, '') + ' ' + COALESCE(a3.Last_Name, ''))) AS Auditor3_Name
        FROM dbo.tbl_WorkflowProcess wf
        LEFT JOIN dbo.tbl_Certification_Bodies cb ON wf.Certification_Body = cb.ID
        LEFT JOIN dbo.tbl_Auditees aud ON wf.AuditeeID = aud.ID
        LEFT JOIN dbo.tbl_AuditeeSites s ON wf.SiteID = s.ID
        LEFT JOIN dbo.tbl_Auditors a1 ON wf.Auditor1 = a1.AuditorID
        LEFT JOIN dbo.tbl_Auditors a2 ON wf.Auditor2 = a2.AuditorID
        LEFT JOIN dbo.tbl_Auditors a3 ON wf.Auditor3 = a3.AuditorID
        WHERE wf.WFID = ?
        """,
        (wfid,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Workflow not found")
    wf = rows[0]
    q_rows = execute_query("SELECT TOP 1 * FROM dbo.tbl_Quoting WHERE WFID = ? ORDER BY QuoteID DESC", (wfid,))
    q = q_rows[0] if q_rows else {}
    txs = execute_query("SELECT * FROM dbo.tbl_Quote_Transactions WHERE WFID = ? ORDER BY [Order] ASC, ID ASC", (wfid,))
    try:
        admin_rows = execute_query(
            "SELECT TOP 1 Company_Name, Company_Address, Telephone, VAT_Nr, Website, FinanceEmail FROM dbo.tbl_Admin ORDER BY ID ASC"
        )
        admin = admin_rows[0] if admin_rows else {}
    except Exception:
        admin = {}

    def fmt_dt(v):
        if not v:
            return "-"
        return v.strftime("%d %b %Y") if hasattr(v, "strftime") else str(v)[:10]

    def esc(v):
        return _html.escape(str(v)) if v is not None else ""

    def fmt_rich_lines(v):
        if not v:
            return ""
        text = re.sub(r"(?i)<\s*br\s*/?\s*>", "\n", str(v))
        text = re.sub(r"<[^>]+>", "", text)
        text = _html.unescape(text)
        lines = [esc(line.strip()) for line in text.splitlines() if line.strip()]
        return "<br>".join(lines)

    admin_parts = []
    if admin.get("Company_Name"):
        admin_parts.append(f'<div style="font-weight:700;color:#001429;">{esc(admin["Company_Name"])}</div>')
    addr_html = fmt_rich_lines(admin.get("Company_Address"))
    if addr_html:
        admin_parts.append(f"<div>{addr_html}</div>")
    if admin.get("Telephone"):
        admin_parts.append(f"<div>{esc(admin['Telephone'])}</div>")
    if admin.get("FinanceEmail"):
        admin_parts.append(f"<div>{esc(admin['FinanceEmail'])}</div>")
    if admin.get("Website"):
        admin_parts.append(f"<div>{esc(admin['Website'])}</div>")
    if admin.get("VAT_Nr"):
        admin_parts.append(f"<div>Vat Number {esc(admin['VAT_Nr'])}</div>")
    admin_details_html = "".join(admin_parts)

    q_status = (q.get("Quote_Status") or "Preparing").strip()
    is_authorised = q_status in ("Authorised", "Sent to Client", "Accepted")
    not_auth_banner = "" if is_authorised else '<div class="not-auth">QUOTE NOT AUTHORISED</div>'

    valid_to_str = fmt_dt(q.get("Quote_ValidTo"))
    expiry_note = f'<div class="expiry-note">Please confirm before expiry date {esc(valid_to_str)}</div>' if q.get("Quote_ValidTo") else ""

    billing_lines = [esc(wf.get("CB_Name") or "-")]
    if wf.get("Billing_Physical_Address"):
        billing_lines.append(esc(wf.get("Billing_Physical_Address")).replace("\n", "<br>"))
    if wf.get("Billing_Country"):
        billing_lines.append(esc(wf.get("Billing_Country")))
    billing_html = "<br>".join(billing_lines)

    site_loc_parts = [p for p in [wf.get("Site_Address"), wf.get("Site_Country")] if p]
    site_loc = ", ".join(site_loc_parts) if site_loc_parts else (wf.get("SiteName") or "-")

    dates_confirmed = bool(wf.get("Audit_Dates_Confirmed"))
    dates_tbc_html = "" if dates_confirmed else '<div class="dates-tbc">Audit Dates to be Confirmed</div>'

    win_from = fmt_dt(wf.get("AuditWindow_From")) if wf.get("AuditWindow_From") else "-"
    win_to = fmt_dt(wf.get("AuditWindow_To")) if wf.get("AuditWindow_To") else "-"
    window_str = f"{win_from} to {win_to}" if (wf.get("AuditWindow_From") or wf.get("AuditWindow_To")) else "-"

    tx_html = "".join(
        f"""
        <tr>
          <td style="text-align:center;">{t.get('Order') or ''}</td>
          <td style="text-align:right;">{t.get('Quantity') or 0}</td>
          <td>{esc(t.get('Unit') or '')}</td>
          <td>{esc(t.get('Category') or '')}</td>
          <td>{esc(t.get('Description') or '')}</td>
          <td style="text-align:right;">€{(t.get('Unit_Price') or 0):,.2f}</td>
          <td style="text-align:right;">€{(t.get('Line_Total') or 0):,.2f}</td>
          <td style="text-align:right;">{t.get('Vat_Perc') or 0}%</td>
        </tr>
        """
        for t in txs
    )

    sub = float(q.get("Quote_SubTotal") or sum(float(t.get("Line_Total") or 0) for t in txs))
    vat = float(q.get("Quote_VAT") or sum(float(t.get("Vat_Amount") or 0) for t in txs))
    tot = float(q.get("Quote_Total") or (sub + vat))

    effective_hide_auditors = bool(hide_auditors) if hide_auditors is not None else bool(wf.get("Hide_AuditorName_Quote"))
    aud_items = []
    if not effective_hide_auditors:
        if wf.get("Auditor1_Name"):
            aud_items.append(f"<div><strong>Auditor 1:</strong> {esc(wf['Auditor1_Name'])}</div>")
        if wf.get("Auditor2_Name"):
            aud_items.append(f"<div><strong>Auditor 2:</strong> {esc(wf['Auditor2_Name'])}</div>")
        if wf.get("Auditor3_Name"):
            aud_items.append(f"<div><strong>Auditor 3:</strong> {esc(wf['Auditor3_Name'])}</div>")
    auditors_html = f'<div class="auditors-box">{"".join(aud_items)}</div>' if aud_items else ""

    raw_terms = (wf.get("Quote_Terms") or "").strip()
    if raw_terms:
        terms_html = raw_terms if ("<" in raw_terms and ">" in raw_terms) else esc(raw_terms).replace("\n", "<br>")
    else:
        terms_html = ""
    comments_raw = (wf.get("Quote_Addit_Comments") or "").strip()
    comments_html = esc(comments_raw).replace("\n", "<br>") if comments_raw else ""

    html = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Quotation {esc(q.get('QuoteRef') or f'WFID #{wfid}')}</title>
  <style>
    body {{ font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; max-width: 920px; margin: 1.5rem auto; padding: 0 1.5rem; font-size: 0.88rem; }}
    .top {{ display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #001429; padding-bottom: 0.9rem; margin-bottom: 0.9rem; }}
    .top img {{ height: 52px; }}
    .company-tag {{ font-size: 0.78rem; color: #475569; margin-top: 4px; line-height: 1.3; }}
    .admin-details {{ text-align: right; font-size: 0.8rem; color: #1e293b; line-height: 1.45; }}
    .quote-header {{ display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 1rem; }}
    .not-auth {{ display: inline-block; background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; padding: 0.2rem 0.6rem; border-radius: 4px; font-weight: 700; font-size: 0.8rem; margin-bottom: 0.35rem; }}
    .expiry-note {{ font-size: 0.8rem; color: #b91c1c; font-weight: 600; margin-top: 0.25rem; }}
    .meta-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem; background: #f8fafc; padding: 0.85rem 1rem; border-radius: 8px; border: 1px solid #e2e8f0; line-height: 1.55; }}
    .dates-tbc {{ color: #b91c1c; font-weight: 700; font-size: 0.82rem; margin-top: 0.25rem; }}
    table {{ width: 100%; border-collapse: collapse; margin-bottom: 1rem; }}
    th {{ background: #001429; color: #fff; text-align: left; padding: 0.5rem 0.6rem; font-size: 0.8rem; }}
    td {{ padding: 0.45rem 0.6rem; border-bottom: 1px solid #e2e8f0; font-size: 0.84rem; }}
    .bottom-row {{ display: flex; justify-content: space-between; align-items: flex-start; gap: 1.5rem; margin-bottom: 1.25rem; }}
    .auditors-box {{ background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.65rem 0.9rem; min-width: 240px; line-height: 1.6; }}
    .totals {{ margin-left: auto; width: 300px; margin-bottom: 0; }}
    .totals td {{ border: none; padding: 0.28rem 0.5rem; }}
    .grand {{ font-size: 1.05rem; font-weight: 700; border-top: 2px solid #001429 !important; }}
    .terms-section {{ border-top: 1px solid #cbd5e1; padding-top: 0.9rem; text-align: center; font-size: 0.82rem; line-height: 1.5; color: #334155; }}
    .terms-section .custom-terms {{ margin-bottom: 0.6rem; }}
    .terms-section .comments-box {{ background: #f8fafc; padding: 0.6rem 0.9rem; border-radius: 6px; border: 1px solid #e2e8f0; margin-bottom: 0.8rem; text-align: left; }}
    .terms-divider {{ border: none; border-top: 1px solid #cbd5e1; margin: 0.75rem 0; }}
    .terms-night {{ color: #dc2626; margin-top: 0.5rem; }}
    @media print {{ .no-print {{ display: none; }} body {{ margin: 0.5rem auto; }} }}
  </style>
</head>
<body>
  <div class="no-print" style="text-align:right;margin-bottom:0.85rem;">
    <button onclick="window.print()" style="background:#001429;color:#fff;border:none;padding:0.5rem 1.1rem;border-radius:6px;cursor:pointer;font-weight:600;">Print / Save PDF</button>
  </div>
  <div class="top">
    <div>
      <img src="/static/Logo Login Screen Homepage.jpg" alt="Approven Partners">
      <div class="company-tag"><strong>{esc(admin.get('Company_Name') or 'Approven Partners LLP')}</strong><br>Specialist in CSR reporting &amp; Ethical Supply Chain audits</div>
    </div>
    <div class="admin-details">
      {admin_details_html}
    </div>
  </div>
  <div class="quote-header">
    <div>
      {not_auth_banner}
      <h1 style="margin:0;color:#001429;letter-spacing:0.5px;">QUOTATION</h1>
      {expiry_note}
    </div>
    <div style="text-align:right;line-height:1.5;">
      <div><strong>Quotation Number:</strong> {esc(q.get('QuoteRef') or f'#{wfid}')}</div>
      <div><strong>Quote Date:</strong> {esc(fmt_dt(q.get('Date_Submitted')))}</div>
      <div><strong>Valid till (noon CET):</strong> {esc(valid_to_str)}</div>
    </div>
  </div>
  <div class="meta-grid">
    <div>
      <div style="margin-bottom:0.35rem;"><strong>To:</strong><br>{billing_html}</div>
      <div><strong>Customer Number:</strong> {esc(wf.get('Customer_Number') or '-')}</div>
      <div><strong>Your Reference:</strong> {esc(q.get('Reference') or '-')}</div>
      <div><strong>PO Number:</strong> {esc(q.get('PO_Number') or '-')}</div>
    </div>
    <div>
      <div><strong>Auditee:</strong> {esc(wf.get('Auditee_Name') or '-')}</div>
      <div><strong>Location:</strong> {esc(site_loc)}</div>
      <div><strong>Audit Type:</strong> {esc(wf.get('Audit_Type') or '-')} {f"({esc(wf.get('Audit_Program'))})" if wf.get('Audit_Program') else ''}</div>
      <div><strong>Announcement Type:</strong> {esc(wf.get('Announcement') or '-')}</div>
      <div><strong>Audit Start Date:</strong> {esc(fmt_dt(wf.get('Audit_Start_Date')))} &nbsp;|&nbsp; <strong>End Date:</strong> {esc(fmt_dt(wf.get('Audit_End_Date')))}</div>
      <div><strong>Audit Required in Period:</strong> {esc(window_str)}</div>
      {dates_tbc_html}
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th style="text-align:center;">Order</th><th>Qty</th><th>Unit</th><th>Category</th><th>Description</th>
        <th style="text-align:right;">Unit Price €</th><th style="text-align:right;">Line Total € (ex VAT)</th><th style="text-align:right;">VAT %</th>
      </tr>
    </thead>
    <tbody>{tx_html or '<tr><td colspan="8" style="text-align:center;color:#64748b;">No line items</td></tr>'}</tbody>
  </table>
  <div class="bottom-row">
    {auditors_html}
    <table class="totals">
      <tr><td>Total excl VAT:</td><td style="text-align:right;">€{sub:,.2f}</td></tr>
      <tr><td>VAT:</td><td style="text-align:right;">€{vat:,.2f}</td></tr>
      <tr><td class="grand">Total Amount:</td><td class="grand" style="text-align:right;">€{tot:,.2f}</td></tr>
    </table>
  </div>
  <div class="terms-section">
    {f'<div class="custom-terms">{terms_html}</div>' if terms_html else ''}
    {f'<div class="comments-box"><strong>Additional Comments:</strong><br>{comments_html}</div>' if comments_html else ''}
    <hr class="terms-divider">
    <div>Please note that acceptance of this quote should be provided in writing before the expiry date.</div>
    <div style="font-weight:700;margin:0.25rem 0;">After this date, our reserved availability is no longer guaranteed.</div>
    <div>Audits that are cancelled 10 to 5 days before the audit date, are to be charged 50% of our day rates. Cancellation within five days from the audit are 100% chargeable. In both cases non-refundable out-of-pocket expenses are added.</div>
    <div class="terms-night">Conducting audits during night shifts is excluded unless explicitly stated in the quotation. If night shift work needs to be included in the audit, this must be arranged well in advance. Additional costs will apply, depending on the specific shift times and languages required on site.</div>
  </div>
</body>
</html>"""
    return HTMLResponse(content=html)
