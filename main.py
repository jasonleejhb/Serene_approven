import os
import time
import secrets
from typing import Optional, List
from pydantic import BaseModel
from fastapi import FastAPI, Request, Form, Depends, HTTPException, status
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware
import pyodbc
from sync_data import sync_access_to_sql, get_last_sync_info

app = FastAPI(title="Approven - Audit Management System")

# Secret key for session management (max_age=None creates a session cookie that expires when browser is closed)
SECRET_KEY = "approven_secret_key_fixed_persistent_2026"
app.add_middleware(SessionMiddleware, secret_key=SECRET_KEY, max_age=None)

@app.middleware("http")
async def add_no_cache_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# Mount static files directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
static_dir = os.path.join(BASE_DIR, "static")
os.makedirs(static_dir, exist_ok=True)

app.mount("/static", StaticFiles(directory=static_dir), name="static")
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))

# Mount Mobile static files and Mobile router under /m
mobile_dir = os.path.join(BASE_DIR, "Mobile")
mobile_static_dir = os.path.join(mobile_dir, "static")
if os.path.exists(mobile_static_dir):
    app.mount("/m/static", StaticFiles(directory=mobile_static_dir), name="mobile_static")

try:
    from Mobile.mobile_router import mobile_router
    app.include_router(mobile_router, prefix="/m")
except Exception as e:
    print(f"Error loading mobile router: {e}")

# Mount CustomerPortal static files and CustomerPortal router under /customerportal
customer_portal_dir = os.path.join(BASE_DIR, "CustomerPortal")
customer_portal_static = os.path.join(customer_portal_dir, "static")
if os.path.exists(customer_portal_static):
    app.mount("/customerportal/static", StaticFiles(directory=customer_portal_static), name="customerportal_static")

try:
    from CustomerPortal.customerportal_router import customerportal_router
    app.include_router(customerportal_router, prefix="/customerportal")
except Exception as e:
    print(f"Error loading customer portal router: {e}")

try:
    from workflows_router import workflows_router
    app.include_router(workflows_router)
except Exception as e:
    print(f"Error loading workflows router: {e}")

# DB Connection Helper
from db_config import DB_CONN_STR

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

def get_countries_list():
    rows = execute_query("SELECT Country FROM dbo.tbl_Countries WHERE Country IS NOT NULL AND Country <> ''")
    countries = set()
    for r in rows:
        name = r.get("Country", "")
        if name:
            if 'land Islands' in name or name.startswith('\ufffdland') or name.startswith('land'):
                name = 'Aland Islands'
            else:
                name = name.replace('\ufffd', '').replace('Cte', 'Cote').replace('Curaao', 'Curacao').replace('Runion', 'Reunion').replace('Barthlemy', 'Barthelemy').strip()
            if name:
                countries.add(name)
    return sorted(list(countries))

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(content=b"", status_code=204)

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    user = request.session.get("user")
    if not user:
        return RedirectResponse(url="/login")
    cache_buster = int(time.time())
    response = templates.TemplateResponse(request=request, name="index.html", context={"user": user, "countries": get_countries_list(), "cache_buster": cache_buster})
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    user = request.session.get("user")
    if user:
        return RedirectResponse(url="/")
    cache_buster = int(time.time())
    return templates.TemplateResponse(request=request, name="login.html", context={"error": None, "cache_buster": cache_buster})

@app.post("/api/login")
async def api_login(request: Request, username: str = Form(...), password: str = Form(...)):
    query = "SELECT UserID, Username, First_Name, Last_Name, Email, Status FROM dbo.tbl_Users WHERE LOWER(Username) = LOWER(?) AND Password = ?"
    users = execute_query(query, (username.strip(), password.strip()))
    
    if not users:
        return JSONResponse(status_code=401, content={"success": False, "message": "Invalid username or password."})
    
    user = users[0]
    display_name = user["First_Name"] if user["First_Name"] else user["Username"]
    
    request.session["user"] = {
        "user_id": user["UserID"],
        "username": user["Username"],
        "display_name": display_name,
        "email": user["Email"]
    }
    
    return {"success": True, "redirect": "/"}

@app.get("/logout")
async def logout(request: Request):
    request.session.clear()
    return RedirectResponse(url="/login", status_code=status.HTTP_302_FOUND)

@app.get("/api/dashboard-stats")
async def dashboard_stats(request: Request):
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    stats = {}
    try:
        stats["audits_count"] = execute_query("SELECT COUNT(*) as cnt FROM dbo.tbl_WorkflowProcess")[0]["cnt"]
        stats["cb_count"] = execute_query("SELECT COUNT(*) as cnt FROM dbo.tbl_Certification_Bodies")[0]["cnt"]
        stats["auditees_count"] = execute_query("SELECT COUNT(*) as cnt FROM dbo.tbl_Auditees")[0]["cnt"]
        stats["auditors_count"] = execute_query("SELECT COUNT(*) as cnt FROM dbo.tbl_Auditors")[0]["cnt"]
        stats["quotes_count"] = execute_query("SELECT COUNT(*) as cnt FROM dbo.tbl_Quoting")[0]["cnt"]
        stats["users_count"] = execute_query("SELECT COUNT(*) as cnt FROM dbo.tbl_Users")[0]["cnt"]
    except Exception as e:
        print("Stats query error:", e)
        stats = {
            "audits_count": 0, "cb_count": 0, "auditees_count": 0,
            "auditors_count": 0, "quotes_count": 0, "users_count": 0
        }
    
    return stats

@app.get("/api/sync-status")
async def get_sync_status(request: Request):
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return get_last_sync_info()

@app.post("/api/sync-data")
async def post_sync_data(request: Request):
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        res = sync_access_to_sql()
        return {"success": True, "message": res.get("message", "Sync successful"), **res}
    except Exception as e:
        return {"success": False, "message": str(e)}

@app.get("/api/dashboard-analytics")
async def get_dashboard_analytics(
    request: Request,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None
):
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    date_clause = ""
    date_params = []
    date_expr = "(CAST(COALESCE(wf.Audit_Start_Date, wf.AuditWindow_From) AS DATE))"
    if from_date and from_date.strip():
        date_clause += f" AND {date_expr} >= CAST(? AS DATE)"
        date_params.append(from_date.strip())
    if to_date and to_date.strip():
        date_clause += f" AND {date_expr} <= CAST(? AS DATE)"
        date_params.append(to_date.strip())
        
    # Tile 1: Audits & Quoted Amount grouped by Certification Body (excluding Cancelled)
    query1 = f"""
        SELECT 
            ISNULL(cb.Company_Name, 'Unassigned') as cb_name, 
            COUNT(wf.WFID) as audit_count, 
            ISNULL(SUM(q.Quote_SubTotal), 0) as total_quoted
        FROM dbo.tbl_WorkflowProcess wf
        LEFT JOIN dbo.tbl_Certification_Bodies cb ON wf.Certification_Body = cb.ID
        LEFT JOIN dbo.tbl_Quoting q ON wf.WFID = q.WFID
        WHERE wf.Status <> 'Cancelled' AND wf.Status IN ('Pending', 'Confirmed', 'Complete') {date_clause}
        GROUP BY cb.Company_Name
        ORDER BY audit_count DESC
    """
    tile1 = execute_query(query1, tuple(date_params))
    
    # Tile 2: Count of audits per Status (Pending -> Confirmed -> Complete)
    query2 = f"""
        SELECT 
            s.Status, 
            ISNULL(COUNT(wf.WFID), 0) as audit_count
        FROM (VALUES ('Pending'), ('Confirmed'), ('Complete')) s(Status)
        LEFT JOIN dbo.tbl_WorkflowProcess wf ON wf.Status = s.Status AND wf.Status <> 'Cancelled' {date_clause}
        GROUP BY s.Status
        ORDER BY CASE s.Status WHEN 'Pending' THEN 1 WHEN 'Confirmed' THEN 2 WHEN 'Complete' THEN 3 ELSE 4 END
    """
    tile2 = execute_query(query2, tuple(date_params))
    
    # Tile 3: Total value & count of quotes by Quote_Status (Preparing -> Sent to Client -> Accepted)
    query3 = f"""
        SELECT 
            qs.Quote_Status, 
            ISNULL(SUM(q.Quote_SubTotal), 0) as total_value, 
            COUNT(q.QuoteID) as quote_count
        FROM (VALUES ('Preparing'), ('Sent to Client'), ('Accepted')) qs(Quote_Status)
        LEFT JOIN (
            SELECT q.Quote_Status, q.Quote_SubTotal, q.QuoteID
            FROM dbo.tbl_Quoting q
            INNER JOIN dbo.tbl_WorkflowProcess wf ON q.WFID = wf.WFID
            WHERE wf.Status <> 'Cancelled' {date_clause}
        ) q ON q.Quote_Status = qs.Quote_Status
        GROUP BY qs.Quote_Status
        ORDER BY CASE qs.Quote_Status WHEN 'Preparing' THEN 1 WHEN 'Sent to Client' THEN 2 WHEN 'Accepted' THEN 3 ELSE 4 END
    """
    tile3 = execute_query(query3, tuple(date_params))
    
    # Tile 4: Quotes per Certification Body (Accepted vs Declined)
    query4 = f"""
        SELECT 
            ISNULL(cb.Company_Name, 'Unassigned') as cb_name,
            q.Quote_Status,
            COUNT(q.QuoteID) as quote_count,
            ISNULL(SUM(q.Quote_SubTotal), 0) as total_quoted
        FROM dbo.tbl_Quoting q
        INNER JOIN dbo.tbl_WorkflowProcess wf ON q.WFID = wf.WFID
        LEFT JOIN dbo.tbl_Certification_Bodies cb ON wf.Certification_Body = cb.ID
        WHERE wf.Status <> 'Cancelled' 
          AND q.Quote_Status IN ('Accepted', 'Declined')
          {date_clause}
        GROUP BY cb.Company_Name, q.Quote_Status
        ORDER BY cb.Company_Name ASC, q.Quote_Status ASC
    """
    tile4 = execute_query(query4, tuple(date_params))

    # Tile 5: Audits per Auditor (Confirmed vs Complete)
    date_clause_aw = ""
    if from_date and from_date.strip():
        date_clause_aw += " AND aw.Audit_Date >= CAST(? AS DATE)"
    if to_date and to_date.strip():
        date_clause_aw += " AND aw.Audit_Date <= CAST(? AS DATE)"

    query5 = f"""
        WITH AuditorWorkflows AS (
            SELECT wf.WFID, wf.Status, wf.Auditor1 as AuditorID, CAST(COALESCE(wf.Audit_Start_Date, wf.AuditWindow_From) AS DATE) as Audit_Date
            FROM dbo.tbl_WorkflowProcess wf
            WHERE wf.Auditor1 IS NOT NULL AND wf.Auditor1 > 0 AND wf.Status <> 'Cancelled'
            UNION ALL
            SELECT wf.WFID, wf.Status, wf.Auditor2 as AuditorID, CAST(COALESCE(wf.Audit_Start_Date, wf.AuditWindow_From) AS DATE) as Audit_Date
            FROM dbo.tbl_WorkflowProcess wf
            WHERE wf.Auditor2 IS NOT NULL AND wf.Auditor2 > 0 AND wf.Status <> 'Cancelled'
            UNION ALL
            SELECT wf.WFID, wf.Status, wf.Auditor3 as AuditorID, CAST(COALESCE(wf.Audit_Start_Date, wf.AuditWindow_From) AS DATE) as Audit_Date
            FROM dbo.tbl_WorkflowProcess wf
            WHERE wf.Auditor3 IS NOT NULL AND wf.Auditor3 > 0 AND wf.Status <> 'Cancelled'
        )
        SELECT 
            a.AuditorID,
            RTRIM(LTRIM(ISNULL(a.First_Name, '') + ' ' + ISNULL(a.Last_Name, ''))) as auditor_name,
            aw.Status,
            COUNT(DISTINCT aw.WFID) as audit_count
        FROM AuditorWorkflows aw
        INNER JOIN dbo.tbl_Auditors a ON aw.AuditorID = a.AuditorID
        WHERE aw.Status IN ('Confirmed', 'Complete') {date_clause_aw}
        GROUP BY a.AuditorID, a.First_Name, a.Last_Name, aw.Status
        ORDER BY auditor_name ASC, aw.Status ASC
    """
    tile5 = execute_query(query5, tuple(date_params))

    # Tile 6: Count of audits per Audit_Program split by Status (Pending, Confirmed, Complete)
    query6 = f"""
        SELECT 
            ISNULL(wf.Audit_Program, 'Unassigned') as audit_program, 
            wf.Status,
            COUNT(wf.WFID) as audit_count
        FROM dbo.tbl_WorkflowProcess wf
        WHERE wf.Status <> 'Cancelled' AND wf.Status IN ('Pending', 'Confirmed', 'Complete') {date_clause}
        GROUP BY wf.Audit_Program, wf.Status
        ORDER BY audit_program ASC
    """
    tile6 = execute_query(query6, tuple(date_params))
    
    return {
        "tile1": tile1,
        "tile2": tile2,
        "tile3": tile3,
        "tile4": tile4,
        "tile5": tile5,
        "tile6": tile6
    }

@app.get("/api/dashboard-drilldown")
async def get_dashboard_drilldown(
    request: Request,
    cb_name: Optional[str] = None,
    workflow_status: Optional[str] = None,
    quote_status: Optional[str] = None,
    audit_program: Optional[str] = None,
    auditor_id: Optional[int] = None,
    auditor_name: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None
):
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
        
    params = []
    where_clauses = ["wf.Status <> 'Cancelled'"]
    
    if cb_name and cb_name.strip():
        where_clauses.append("ISNULL(cb.Company_Name, 'Unassigned') = ?")
        params.append(cb_name.strip())
        
    if workflow_status and workflow_status.strip():
        where_clauses.append("wf.Status = ?")
        params.append(workflow_status.strip())
        
    if quote_status and quote_status.strip():
        where_clauses.append("q.Quote_Status = ?")
        params.append(quote_status.strip())
        
    if audit_program and audit_program.strip():
        where_clauses.append("ISNULL(wf.Audit_Program, 'Unassigned') = ?")
        params.append(audit_program.strip())

    if auditor_id is not None:
        where_clauses.append("(wf.Auditor1 = ? OR wf.Auditor2 = ? OR wf.Auditor3 = ?)")
        params.extend([auditor_id, auditor_id, auditor_id])
    elif auditor_name and auditor_name.strip():
        where_clauses.append("""(
            (RTRIM(LTRIM(ISNULL(a1.First_Name, '') + ' ' + ISNULL(a1.Last_Name, ''))) = ?) OR
            (RTRIM(LTRIM(ISNULL(a2.First_Name, '') + ' ' + ISNULL(a2.Last_Name, ''))) = ?) OR
            (RTRIM(LTRIM(ISNULL(a3.First_Name, '') + ' ' + ISNULL(a3.Last_Name, ''))) = ?)
        )""")
        name_val = auditor_name.strip()
        params.extend([name_val, name_val, name_val])
        
    date_expr = "(CAST(COALESCE(wf.Audit_Start_Date, wf.AuditWindow_From) AS DATE))"
    if from_date and from_date.strip():
        where_clauses.append(f"{date_expr} >= CAST(? AS DATE)")
        params.append(from_date.strip())
    if to_date and to_date.strip():
        where_clauses.append(f"{date_expr} <= CAST(? AS DATE)")
        params.append(to_date.strip())
        
    where_sql = " AND ".join(where_clauses)
    
    query = f"""
        SELECT 
            wf.WFID,
            wf.Project_Nr,
            wf.Status as Workflow_Status,
            ISNULL(cb.Company_Name, 'Unassigned') as CB_Name,
            ISNULL(aud.Company_Name, '-') as Auditee_Name,
            CASE 
                WHEN s.Address IS NOT NULL AND s.Country IS NOT NULL THEN s.Address + ', ' + s.Country
                WHEN s.Address IS NOT NULL THEN s.Address
                WHEN s.Country IS NOT NULL THEN s.Country
                ELSE '-'
            END as Site_Location,
            ISNULL(wf.Audit_Program, 'Unassigned') as Audit_Program,
            wf.Audit_Start_Date,
            wf.Audit_End_Date,
            wf.AuditWindow_From,
            wf.AuditWindow_To,
            wf.AuditorsRequired,
            wf.Total_Mandays,
            q.Quote_Status,
            q.Quote_SubTotal,
            RTRIM(LTRIM(
                COALESCE(a1.First_Name + ' ' + a1.Last_Name, '') +
                CASE WHEN a2.First_Name IS NOT NULL AND a2.First_Name <> '' THEN ', ' + a2.First_Name + ' ' + a2.Last_Name ELSE '' END +
                CASE WHEN a3.First_Name IS NOT NULL AND a3.First_Name <> '' THEN ', ' + a3.First_Name + ' ' + a3.Last_Name ELSE '' END
            )) as Auditor_Names
        FROM dbo.tbl_WorkflowProcess wf
        LEFT JOIN dbo.tbl_Certification_Bodies cb ON wf.Certification_Body = cb.ID
        LEFT JOIN dbo.tbl_Auditees aud ON wf.AuditeeID = aud.ID
        LEFT JOIN dbo.tbl_AuditeeSites s ON wf.SiteID = s.ID
        LEFT JOIN dbo.tbl_Quoting q ON wf.WFID = q.WFID
        LEFT JOIN dbo.tbl_Auditors a1 ON wf.Auditor1 = a1.AuditorID
        LEFT JOIN dbo.tbl_Auditors a2 ON wf.Auditor2 = a2.AuditorID
        LEFT JOIN dbo.tbl_Auditors a3 ON wf.Auditor3 = a3.AuditorID
        WHERE {where_sql}
        ORDER BY wf.WFID DESC
    """
    rows = execute_query(query, tuple(params))
    
    formatted_rows = []
    for r in rows:
        start_dt = r.get("Audit_Start_Date") or r.get("AuditWindow_From")
        end_dt = r.get("Audit_End_Date") or r.get("AuditWindow_To")
        
        start_str = start_dt.strftime("%Y-%m-%d") if start_dt else "-"
        end_str = end_dt.strftime("%Y-%m-%d") if end_dt else "-"
        
        row_dict = dict(r)
        row_dict["Audit_Start"] = start_str
        row_dict["Audit_End"] = end_str
        formatted_rows.append(row_dict)
        
    return formatted_rows

@app.get("/api/countries")
async def get_countries(request: Request):
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return get_countries_list()

# --- Audits & Workflows List API ---

@app.get("/api/audits-list")
async def get_audits_list(
    request: Request,
    status_filter: Optional[str] = "active",  # "active" (excludes Cancelled and Complete) or "all"
    q: Optional[str] = None
):
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    where_clauses = ["1=1"]
    params = []

    if status_filter == "active":
        where_clauses.append("wf.Status NOT IN ('Cancelled', 'Complete')")
    elif status_filter and status_filter.lower() != "all":
        where_clauses.append("wf.Status = ?")
        params.append(status_filter.strip())

    if q and q.strip():
        search_pattern = f"%{q.strip()}%"
        where_clauses.append("""(
            CAST(wf.WFID AS VARCHAR(20)) LIKE ? OR
            wf.Project_Nr LIKE ? OR
            cb.Company_Name LIKE ? OR
            aud.Company_Name LIKE ? OR
            s.SiteName LIKE ? OR
            s.Country LIKE ? OR
            wf.Audit_Program LIKE ? OR
            wf.Audit_Type LIKE ? OR
            wf.Status LIKE ? OR
            q.Quote_Status LIKE ? OR
            a1.First_Name LIKE ? OR a1.Last_Name LIKE ? OR
            a2.First_Name LIKE ? OR a2.Last_Name LIKE ? OR
            a3.First_Name LIKE ? OR a3.Last_Name LIKE ?
        )""")
        params.extend([search_pattern] * 15)

    where_sql = " AND ".join(where_clauses)

    query = f"""
        SELECT 
            wf.WFID,
            wf.Project_Nr,
            wf.Status as Workflow_Status,
            ISNULL(cb.Company_Name, 'Unassigned') as CB_Name,
            ISNULL(aud.Company_Name, '-') as Auditee_Name,
            ISNULL(s.SiteName, '-') as Site_Name,
            ISNULL(s.Country, '-') as Site_Country,
            CASE 
                WHEN s.SiteName IS NOT NULL AND s.Country IS NOT NULL THEN s.SiteName + ' (' + s.Country + ')'
                WHEN s.SiteName IS NOT NULL THEN s.SiteName
                WHEN s.Country IS NOT NULL THEN s.Country
                ELSE '-'
            END as Site_Location,
            ISNULL(wf.Audit_Program, 'Unassigned') as Audit_Program,
            wf.Audit_Type,
            wf.Announcement,
            wf.Audit_Deadline,
            wf.Audit_Start_Date,
            wf.Audit_End_Date,
            wf.AuditWindow_From,
            wf.AuditWindow_To,
            wf.AuditorsRequired,
            wf.Total_Mandays,
            q.Quote_Status,
            COALESCE(q.Quote_SubTotal, wf.Cost_Total_All, wf.Amount_Quoted) as Quote_SubTotal,
            wf.Invoiced,
            wf.Inv_Number,
            wf.Inv_Amount,
            RTRIM(LTRIM(
                COALESCE(NULLIF(RTRIM(a1.First_Name + ' ' + a1.Last_Name), ''), '') +
                CASE WHEN a2.First_Name IS NOT NULL AND RTRIM(a2.First_Name + ' ' + a2.Last_Name) <> '' THEN ', ' + RTRIM(a2.First_Name + ' ' + a2.Last_Name) ELSE '' END +
                CASE WHEN a3.First_Name IS NOT NULL AND RTRIM(a3.First_Name + ' ' + a3.Last_Name) <> '' THEN ', ' + RTRIM(a3.First_Name + ' ' + a3.Last_Name) ELSE '' END
            )) as Auditor_Names
        FROM dbo.tbl_WorkflowProcess wf
        LEFT JOIN dbo.tbl_Certification_Bodies cb ON wf.Certification_Body = cb.ID
        LEFT JOIN dbo.tbl_Auditees aud ON wf.AuditeeID = aud.ID
        LEFT JOIN dbo.tbl_AuditeeSites s ON wf.SiteID = s.ID
        LEFT JOIN dbo.tbl_Quoting q ON wf.WFID = q.WFID
        LEFT JOIN dbo.tbl_Auditors a1 ON wf.Auditor1 = a1.AuditorID
        LEFT JOIN dbo.tbl_Auditors a2 ON wf.Auditor2 = a2.AuditorID
        LEFT JOIN dbo.tbl_Auditors a3 ON wf.Auditor3 = a3.AuditorID
        WHERE {where_sql}
        ORDER BY wf.WFID DESC
    """
    rows = execute_query(query, tuple(params))

    formatted_rows = []
    for r in rows:
        start_dt = r.get("Audit_Start_Date") or r.get("AuditWindow_From")
        end_dt = r.get("Audit_End_Date") or r.get("AuditWindow_To")
        deadline_dt = r.get("Audit_Deadline")
        
        row_dict = dict(r)
        row_dict["Audit_Start"] = start_dt.strftime("%Y-%m-%d") if start_dt else "-"
        row_dict["Audit_End"] = end_dt.strftime("%Y-%m-%d") if end_dt else "-"
        row_dict["Audit_Deadline_Formatted"] = deadline_dt.strftime("%Y-%m-%d") if deadline_dt else "-"
        row_dict["Invoiced"] = bool(r.get("Invoiced", False))
        formatted_rows.append(row_dict)

    return formatted_rows

# --- Certification Bodies API ---

class ContactSchema(BaseModel):
    ID: Optional[int] = None
    CBID: Optional[int] = None
    Status: Optional[str] = 'Active'
    First_Name: Optional[str] = ''
    Last_Name: Optional[str] = ''
    Position: Optional[str] = ''
    Tel: Optional[str] = ''
    Mobile: Optional[str] = ''
    Email: Optional[str] = ''

class CertificationBodySchema(BaseModel):
    Company_Name: str
    Status: Optional[str] = 'Active'
    Customer_Number: Optional[str] = None
    Code: Optional[str] = None
    Billing_Physical_Address: Optional[str] = None
    Billing_Country: Optional[str] = None
    Billing_Contact_Name: Optional[str] = None
class CBProgramSchema(BaseModel):
    ID: Optional[int] = None
    Program: Optional[str] = None
    Mandays: Optional[float] = None
    Manday_Rate: Optional[float] = None
    Report_Percentage: Optional[float] = None

class CBOnboardedAuditorSchema(BaseModel):
    AuditorID: int
    Status: Optional[str] = "Not Onboarded"

class CBAuditorProgramSchema(BaseModel):
    AuditorID: int
    Program: str
    Status: Optional[str] = "Compliant"

class CBPONumberSchema(BaseModel):
    ID: Optional[int] = None
    PONumber: Optional[str] = None
    FromDate: Optional[str] = None
    ToDate: Optional[str] = None

class CertificationBodySchema(BaseModel):
    Status: Optional[str] = 'Active'
    Company_Name: str
    Customer_Number: Optional[str] = None
    Code: Optional[str] = None
    Billing_Physical_Address: Optional[str] = None
    Billing_Country: Optional[str] = None
    Billing_Contact_Name: Optional[str] = None
    Billing_Email: Optional[str] = None
    Billing_Tel: Optional[str] = None
    Comments: Optional[str] = None
    Man_Day_Rate: Optional[float] = None
    Per_KM_Rate: Optional[float] = None
    Travel_Time_Rate_perHour: Optional[float] = None
    Hotel_perNight_Rate: Optional[float] = None
    Report_Fee: Optional[float] = None
    Quote_Terms: Optional[str] = None
    contacts: Optional[List[ContactSchema]] = []
    programs: Optional[List[CBProgramSchema]] = None
    auditors_onboarded: Optional[List[CBOnboardedAuditorSchema]] = None
    auditor_programs: Optional[List[CBAuditorProgramSchema]] = None
    po_numbers: Optional[List[CBPONumberSchema]] = None

@app.get("/api/certification-bodies")
async def get_certification_bodies(
    request: Request,
    q: Optional[str] = None,
    sort_dir: Optional[str] = "asc",
    status_filter: Optional[str] = None
):
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    query = "SELECT ID, Status, Company_Name, Customer_Number, Code, Billing_Physical_Address, Billing_Country, Billing_Email, Billing_Contact_Name, Billing_Tel FROM dbo.tbl_Certification_Bodies WHERE 1=1"
    params = []
    
    if q and q.strip():
        search_pattern = f"%{q.strip()}%"
        query += " AND (Company_Name LIKE ? OR Code LIKE ? OR Billing_Physical_Address LIKE ? OR Billing_Country LIKE ? OR Customer_Number LIKE ? OR Billing_Email LIKE ?)"
        params.extend([search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern])
        
    if status_filter and status_filter.strip() and status_filter.strip().lower() != 'all':
        query += " AND Status = ?"
        params.append(status_filter.strip())
        
    direction = "DESC" if sort_dir and sort_dir.lower() == "desc" else "ASC"
    query += f" ORDER BY Company_Name {direction}"
    
    return execute_query(query, tuple(params))

@app.get("/api/certification-bodies/{cb_id}")
async def get_certification_body_detail(cb_id: int, request: Request):
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    cb_rows = execute_query("SELECT * FROM dbo.tbl_Certification_Bodies WHERE ID = ?", (cb_id,))
    if not cb_rows:
        raise HTTPException(status_code=404, detail="Certification body not found")
    
    cb_detail = cb_rows[0]
    contacts = execute_query("SELECT * FROM dbo.tbl_CertBod_Contacts WHERE CBID = ? ORDER BY ID ASC", (cb_id,))
    cb_detail["contacts"] = contacts
    cb_detail["programs"] = execute_query("SELECT * FROM dbo.tbl_CertBod_Programs WHERE CBID = ? ORDER BY Program ASC", (cb_id,))
    cb_detail["auditors_onboarded"] = execute_query("""
        SELECT a.AuditorID,
               RTRIM(LTRIM(ISNULL(a.First_Name, '') + ' ' + ISNULL(a.Last_Name, ''))) AS Auditor_Name,
               ISNULL(o.Status, 'Not Onboarded') AS Status
        FROM dbo.tbl_Auditors a
        LEFT JOIN dbo.tbl_Auditors_CBs_Onboarded o ON a.AuditorID = o.AuditorID AND o.CB = ?
        WHERE a.Status = 'Active' OR a.Status IS NULL
        ORDER BY a.First_Name ASC, a.Last_Name ASC
    """, (cb_id,))
    cb_detail["auditor_programs"] = execute_query("""
        SELECT ap.AuditorID,
               RTRIM(LTRIM(ISNULL(a.First_Name, '') + ' ' + ISNULL(a.Last_Name, ''))) AS Auditor_Name,
               ap.Program,
               ISNULL(ap.Status, 'Compliant') AS Status,
               ap.Accred_Expiry
        FROM dbo.tbl_Auditor_Programs ap
        JOIN dbo.tbl_Auditors a ON ap.AuditorID = a.AuditorID
        WHERE ap.CertificationBody = ?
        ORDER BY a.First_Name ASC, a.Last_Name ASC, ap.Program ASC
    """, (cb_id,))
    cb_detail["po_numbers"] = execute_query("SELECT * FROM dbo.tbl_CertBodies_PONumbers WHERE CBID = ? ORDER BY ID DESC", (cb_id,))
    cb_detail["audit_history"] = execute_query("""
        SELECT wf.WFID, wf.Project_Nr, wf.Status, ISNULL(aud.Company_Name, '-') AS Auditee_Name,
               wf.Audit_Program, wf.Audit_Type, wf.Audit_Start_Date, wf.Audit_End_Date,
               wf.Total_Mandays, wf.Amount_Quoted
        FROM dbo.tbl_WorkflowProcess wf
        LEFT JOIN dbo.tbl_Auditees aud ON wf.AuditeeID = aud.ID
        WHERE wf.Certification_Body = ?
        ORDER BY wf.WFID DESC
    """, (cb_id,))
    cb_detail["quote_history"] = execute_query("""
        SELECT q.QuoteID, q.WFID, q.QuoteRef, q.Quote_Status, ISNULL(aud.Company_Name, '-') AS Auditee_Name,
               q.Quote_Created, q.Quote_ValidTo, q.Quote_SubTotal, q.Quote_Total
        FROM dbo.tbl_Quoting q
        LEFT JOIN dbo.tbl_Auditees aud ON q.AuditeeID = aud.ID
        WHERE q.CB = ?
        ORDER BY q.QuoteID DESC
    """, (cb_id,))
    cb_detail["all_programs"] = [r["Program"] for r in execute_query("SELECT Program FROM dbo.tbl_AuditPrograms WHERE Program IS NOT NULL ORDER BY Program ASC")]
    return cb_detail

@app.post("/api/certification-bodies")
async def create_certification_body(cb: CertificationBodySchema, request: Request):
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    conn = pyodbc.connect(DB_CONN_STR)
    cursor = conn.cursor()
    try:
        insert_cb_query = """
            INSERT INTO dbo.tbl_Certification_Bodies (
                Status, Company_Name, Customer_Number, Code, Billing_Physical_Address,
                Billing_Country, Billing_Contact_Name, Billing_Email, Billing_Tel,
                Comments, Man_Day_Rate, Per_KM_Rate, Travel_Time_Rate_perHour,
                Hotel_perNight_Rate, Report_Fee, Quote_Terms
            ) OUTPUT INSERTED.ID VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        cursor.execute(insert_cb_query, (
            cb.Status or 'Active', cb.Company_Name, cb.Customer_Number, cb.Code, cb.Billing_Physical_Address,
            cb.Billing_Country, cb.Billing_Contact_Name, cb.Billing_Email, cb.Billing_Tel,
            cb.Comments, cb.Man_Day_Rate, cb.Per_KM_Rate, cb.Travel_Time_Rate_perHour,
            cb.Hotel_perNight_Rate, cb.Report_Fee, cb.Quote_Terms
        ))
        new_id = cursor.fetchone()[0]
        
        if cb.contacts:
            insert_contact_query = """
                INSERT INTO dbo.tbl_CertBod_Contacts (CBID, Status, First_Name, Last_Name, Position, Tel, Mobile, Email)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """
            for contact in cb.contacts:
                cursor.execute(insert_contact_query, (
                    new_id, contact.Status or 'Active', contact.First_Name, contact.Last_Name,
                    contact.Position, contact.Tel, contact.Mobile, contact.Email
                ))
        conn.commit()
        return {"success": True, "id": new_id}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()
        conn.close()

@app.put("/api/certification-bodies/{cb_id}")
async def update_certification_body(cb_id: int, cb: CertificationBodySchema, request: Request):
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    conn = pyodbc.connect(DB_CONN_STR)
    cursor = conn.cursor()
    try:
        update_cb_query = """
            UPDATE dbo.tbl_Certification_Bodies SET
                Status = ?, Company_Name = ?, Customer_Number = ?, Code = ?, Billing_Physical_Address = ?,
                Billing_Country = ?, Billing_Contact_Name = ?, Billing_Email = ?, Billing_Tel = ?,
                Comments = ?, Man_Day_Rate = ?, Per_KM_Rate = ?, Travel_Time_Rate_perHour = ?,
                Hotel_perNight_Rate = ?, Report_Fee = ?, Quote_Terms = ?
            WHERE ID = ?
        """
        cursor.execute(update_cb_query, (
            cb.Status or 'Active', cb.Company_Name, cb.Customer_Number, cb.Code, cb.Billing_Physical_Address,
            cb.Billing_Country, cb.Billing_Contact_Name, cb.Billing_Email, cb.Billing_Tel,
            cb.Comments, cb.Man_Day_Rate, cb.Per_KM_Rate, cb.Travel_Time_Rate_perHour,
            cb.Hotel_perNight_Rate, cb.Report_Fee, cb.Quote_Terms, cb_id
        ))
        
        cursor.execute("SELECT ID FROM dbo.tbl_CertBod_Contacts WHERE CBID = ?", (cb_id,))
        existing_contact_ids = {row[0] for row in cursor.fetchall()}
        
        incoming_contact_ids = set()
        
        insert_contact_query = """
            INSERT INTO dbo.tbl_CertBod_Contacts (CBID, Status, First_Name, Last_Name, Position, Tel, Mobile, Email)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """
        update_contact_query = """
            UPDATE dbo.tbl_CertBod_Contacts SET
                Status = ?, First_Name = ?, Last_Name = ?, Position = ?, Tel = ?, Mobile = ?, Email = ?
            WHERE ID = ? AND CBID = ?
        """
        
        if cb.contacts:
            for contact in cb.contacts:
                if contact.ID and contact.ID in existing_contact_ids:
                    incoming_contact_ids.add(contact.ID)
                    cursor.execute(update_contact_query, (
                        contact.Status or 'Active', contact.First_Name, contact.Last_Name,
                        contact.Position, contact.Tel, contact.Mobile, contact.Email,
                        contact.ID, cb_id
                    ))
                else:
                    cursor.execute(insert_contact_query, (
                        cb_id, contact.Status or 'Active', contact.First_Name, contact.Last_Name,
                        contact.Position, contact.Tel, contact.Mobile, contact.Email
                    ))
                    
        removed_ids = existing_contact_ids - incoming_contact_ids
        if removed_ids:
            delete_query = f"DELETE FROM dbo.tbl_CertBod_Contacts WHERE ID IN ({','.join(['?']*len(removed_ids))}) AND CBID = ?"
            cursor.execute(delete_query, (*list(removed_ids), cb_id))

        if cb.programs is not None:
            cursor.execute("DELETE FROM dbo.tbl_CertBod_Programs WHERE CBID = ?", (cb_id,))
            for p in cb.programs:
                if p.Program:
                    cursor.execute(
                        "INSERT INTO dbo.tbl_CertBod_Programs (CBID, Program, Mandays, Manday_Rate, Report_Percentage) VALUES (?, ?, ?, ?, ?)",
                        (cb_id, p.Program, p.Mandays, p.Manday_Rate, p.Report_Percentage)
                    )

        if cb.auditors_onboarded is not None:
            cursor.execute("DELETE FROM dbo.tbl_Auditors_CBs_Onboarded WHERE CB = ?", (cb_id,))
            for ao in cb.auditors_onboarded:
                cursor.execute(
                    "INSERT INTO dbo.tbl_Auditors_CBs_Onboarded (AuditorID, CB, Status) VALUES (?, ?, ?)",
                    (ao.AuditorID, cb_id, ao.Status or "Not Onboarded")
                )

        if cb.auditor_programs is not None:
            cursor.execute("DELETE FROM dbo.tbl_Auditor_Programs WHERE CertificationBody = ?", (cb_id,))
            for ap in cb.auditor_programs:
                if ap.AuditorID and ap.Program:
                    cursor.execute(
                        "INSERT INTO dbo.tbl_Auditor_Programs (AuditorID, CertificationBody, Program, Accred_Cert_Training_Req, Status, Evidence_Uploaded) VALUES (?, ?, ?, 0, ?, 0)",
                        (ap.AuditorID, cb_id, ap.Program, ap.Status or "Compliant")
                    )

        if cb.po_numbers is not None:
            cursor.execute("DELETE FROM dbo.tbl_CertBodies_PONumbers WHERE CBID = ?", (cb_id,))
            for po in cb.po_numbers:
                if po.PONumber:
                    cursor.execute(
                        "INSERT INTO dbo.tbl_CertBodies_PONumbers (CBID, PONumber, FromDate, ToDate) VALUES (?, ?, ?, ?)",
                        (cb_id, po.PONumber, po.FromDate or None, po.ToDate or None)
                    )
            
        conn.commit()
        return {"success": True}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()
        conn.close()

# --- Auditors API ---

class AuditorCBOnboardedSchema(BaseModel):
    ID: Optional[int] = None
    AuditorID: Optional[int] = None
    CB: int
    Company_Name: Optional[str] = None
    Status: Optional[str] = 'Onboarded'

class AuditorProgramSchema(BaseModel):
    AuditorID: Optional[int] = None
    CertificationBody: int
    Company_Name: Optional[str] = None
    Program: str
    Status: Optional[str] = 'Compliant'
    Accred_Cert_Training_Req: Optional[bool] = False
    Accred_Expiry: Optional[str] = None
    Accred_LastComplete: Optional[str] = None
    Evidence_Uploaded: Optional[bool] = False
    Evidence_Path: Optional[str] = None

class AuditorSchema(BaseModel):
    Status: Optional[str] = 'Active'
    First_Name: str
    Last_Name: str
    Gender: Optional[str] = None
    Email: Optional[str] = None
    Mobile_Nr: Optional[str] = None
    Lead_Auditor: Optional[bool] = False
    APSCA_Nr: Optional[str] = None
    Employment_Type: Optional[str] = None
    Nationality: Optional[str] = None
    Residence_City: Optional[str] = None
    Residence_Country: Optional[str] = None
    Residence_Address: Optional[str] = None
    Comments: Optional[str] = None
    Internal_Onboarding_Complete: Optional[bool] = False
    cbs_onboarded: Optional[List[AuditorCBOnboardedSchema]] = []
    auditor_programs: Optional[List[AuditorProgramSchema]] = []

@app.get("/api/auditors")
async def get_auditors_list(request: Request):
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    query = """
        SELECT AuditorID, Status, First_Name, Last_Name, Gender, Email, Mobile_Nr, Lead_Auditor,
               APSCA_Nr, Employment_Type, Residence_City, Residence_Country, Internal_Onboarding_Complete
        FROM dbo.tbl_Auditors
        ORDER BY First_Name, Last_Name
    """
    rows = execute_query(query)
    for r in rows:
        r["Lead_Auditor"] = bool(r.get("Lead_Auditor", False))
        r["Internal_Onboarding_Complete"] = bool(r.get("Internal_Onboarding_Complete", False))
    return rows

@app.get("/api/auditors/{auditor_id}")
async def get_auditor_detail(auditor_id: int, request: Request):
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    auditors = execute_query("SELECT * FROM dbo.tbl_Auditors WHERE AuditorID = ?", (auditor_id,))
    if not auditors:
        raise HTTPException(status_code=404, detail="Auditor not found")
    
    auditor = auditors[0]
    auditor["Lead_Auditor"] = bool(auditor.get("Lead_Auditor", False))
    auditor["Internal_Onboarding_Complete"] = bool(auditor.get("Internal_Onboarding_Complete", False))
    
    cbs_query = """
        SELECT o.ID, o.AuditorID, o.CB, o.Status, cb.Company_Name
        FROM dbo.tbl_Auditors_CBs_Onboarded o
        LEFT JOIN dbo.tbl_Certification_Bodies cb ON o.CB = cb.ID
        WHERE o.AuditorID = ?
        ORDER BY cb.Company_Name
    """
    auditor["cbs_onboarded"] = execute_query(cbs_query, (auditor_id,))
    
    programs_query = """
        SELECT p.AuditorID, p.CertificationBody, cb.Company_Name, p.Program, p.Status, p.Accred_Cert_Training_Req,
               CAST(p.Accred_Expiry AS VARCHAR(10)) as Accred_Expiry,
               CAST(p.Accred_LastComplete AS VARCHAR(10)) as Accred_LastComplete,
               p.Evidence_Uploaded, p.Evidence_Path
        FROM dbo.tbl_Auditor_Programs p
        LEFT JOIN dbo.tbl_Certification_Bodies cb ON p.CertificationBody = cb.ID
        WHERE p.AuditorID = ?
        ORDER BY cb.Company_Name, p.Program
    """
    progs = execute_query(programs_query, (auditor_id,))
    for pr in progs:
        pr["Accred_Cert_Training_Req"] = bool(pr.get("Accred_Cert_Training_Req", False))
        pr["Evidence_Uploaded"] = bool(pr.get("Evidence_Uploaded", False))
    auditor["auditor_programs"] = progs
    
    return auditor

@app.post("/api/auditors")
async def create_auditor(auditor: AuditorSchema, request: Request):
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        insert_query = """
            INSERT INTO dbo.tbl_Auditors (
                Status, First_Name, Last_Name, Gender, Email, Mobile_Nr, Lead_Auditor,
                APSCA_Nr, Employment_Type, Nationality, Residence_City, Residence_Country,
                Residence_Address, Comments, Internal_Onboarding_Complete
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            SELECT SCOPE_IDENTITY() AS NewID;
        """
        cursor.execute(insert_query, (
            auditor.Status or 'Active', auditor.First_Name, auditor.Last_Name, auditor.Gender,
            auditor.Email, auditor.Mobile_Nr, 1 if auditor.Lead_Auditor else 0, auditor.APSCA_Nr,
            auditor.Employment_Type, auditor.Nationality, auditor.Residence_City, auditor.Residence_Country,
            auditor.Residence_Address, auditor.Comments, 1 if auditor.Internal_Onboarding_Complete else 0
        ))
        cursor.nextset()
        row = cursor.fetchone()
        new_id = int(row[0]) if row else None
        
        if new_id and auditor.cbs_onboarded:
            for cb_item in auditor.cbs_onboarded:
                cursor.execute(
                    "INSERT INTO dbo.tbl_Auditors_CBs_Onboarded (AuditorID, CB, Status) VALUES (?, ?, ?)",
                    (new_id, cb_item.CB, cb_item.Status or 'Onboarded')
                )
                
        if new_id and auditor.auditor_programs:
            for pr in auditor.auditor_programs:
                cursor.execute(
                    """INSERT INTO dbo.tbl_Auditor_Programs (
                        AuditorID, CertificationBody, Program, Accred_Cert_Training_Req, Status,
                        Accred_Expiry, Accred_LastComplete, Evidence_Uploaded, Evidence_Path
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (new_id, pr.CertificationBody, pr.Program, 1 if pr.Accred_Cert_Training_Req else 0,
                     pr.Status or 'Compliant', pr.Accred_Expiry or None, pr.Accred_LastComplete or None,
                     1 if pr.Evidence_Uploaded else 0, pr.Evidence_Path)
                )
                
        conn.commit()
        return {"success": True, "AuditorID": new_id}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()
        conn.close()

@app.put("/api/auditors/{auditor_id}")
async def update_auditor(auditor_id: int, auditor: AuditorSchema, request: Request):
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        update_query = """
            UPDATE dbo.tbl_Auditors SET
                Status = ?, First_Name = ?, Last_Name = ?, Gender = ?, Email = ?, Mobile_Nr = ?,
                Lead_Auditor = ?, APSCA_Nr = ?, Employment_Type = ?, Nationality = ?, Residence_City = ?,
                Residence_Country = ?, Residence_Address = ?, Comments = ?, Internal_Onboarding_Complete = ?
            WHERE AuditorID = ?
        """
        cursor.execute(update_query, (
            auditor.Status or 'Active', auditor.First_Name, auditor.Last_Name, auditor.Gender,
            auditor.Email, auditor.Mobile_Nr, 1 if auditor.Lead_Auditor else 0, auditor.APSCA_Nr,
            auditor.Employment_Type, auditor.Nationality, auditor.Residence_City, auditor.Residence_Country,
            auditor.Residence_Address, auditor.Comments, 1 if auditor.Internal_Onboarding_Complete else 0,
            auditor_id
        ))
        
        # Sync CBs Onboarded
        cursor.execute("DELETE FROM dbo.tbl_Auditors_CBs_Onboarded WHERE AuditorID = ?", (auditor_id,))
        if auditor.cbs_onboarded:
            for cb_item in auditor.cbs_onboarded:
                cursor.execute(
                    "INSERT INTO dbo.tbl_Auditors_CBs_Onboarded (AuditorID, CB, Status) VALUES (?, ?, ?)",
                    (auditor_id, cb_item.CB, cb_item.Status or 'Onboarded')
                )
                
        # Sync Auditor Programs
        cursor.execute("DELETE FROM dbo.tbl_Auditor_Programs WHERE AuditorID = ?", (auditor_id,))
        if auditor.auditor_programs:
            for pr in auditor.auditor_programs:
                cursor.execute(
                    """INSERT INTO dbo.tbl_Auditor_Programs (
                        AuditorID, CertificationBody, Program, Accred_Cert_Training_Req, Status,
                        Accred_Expiry, Accred_LastComplete, Evidence_Uploaded, Evidence_Path
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (auditor_id, pr.CertificationBody, pr.Program, 1 if pr.Accred_Cert_Training_Req else 0,
                     pr.Status or 'Compliant', pr.Accred_Expiry or None, pr.Accred_LastComplete or None,
                     1 if pr.Evidence_Uploaded else 0, pr.Evidence_Path)
                )
                
        conn.commit()
        return {"success": True}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()
        conn.close()

@app.post("/api/auditors/{auditor_id}/seed-programs")
async def seed_auditor_programs(auditor_id: int, request: Request):
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT ID FROM dbo.tbl_Certification_Bodies WHERE Status = 'Active' OR Status IS NULL")
        cb_ids = [row[0] for row in cursor.fetchall()]
        
        cursor.execute("SELECT Program FROM dbo.tbl_AuditPrograms WHERE Program IS NOT NULL AND Program <> ''")
        programs = [row[0] for row in cursor.fetchall()]
        
        cursor.execute("SELECT CertificationBody, Program FROM dbo.tbl_Auditor_Programs WHERE AuditorID = ?", (auditor_id,))
        existing_combos = {(row[0], row[1]) for row in cursor.fetchall()}
        
        added_count = 0
        for cb_id in cb_ids:
            for prog in programs:
                if (cb_id, prog) not in existing_combos:
                    cursor.execute(
                        """INSERT INTO dbo.tbl_Auditor_Programs (
                            AuditorID, CertificationBody, Program, Status, Accred_Cert_Training_Req, Evidence_Uploaded
                        ) VALUES (?, ?, ?, 'Compliant', 0, 0)""",
                        (auditor_id, cb_id, prog)
                    )
                    added_count += 1
                    
        conn.commit()
        return {"success": True, "added_count": added_count}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()
        conn.close()

@app.get("/api/audit-programs")
async def get_audit_programs(request: Request):
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    rows = execute_query("SELECT Program FROM dbo.tbl_AuditPrograms WHERE Program IS NOT NULL AND Program <> '' ORDER BY Program")
    return [r["Program"] for r in rows]

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
