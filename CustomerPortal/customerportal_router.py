import os
import re
import time
import random
import secrets
import smtplib
import shutil
import uuid
import datetime
from pathlib import Path
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formataddr
from typing import Optional, Dict, Any, List

import pyodbc
from fastapi import APIRouter, Request, Response, Form, UploadFile, File, Depends, HTTPException, status, Query
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

customerportal_router = APIRouter()

PORTAL_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = PORTAL_DIR / "templates"
STATIC_DIR = PORTAL_DIR / "static"
UPLOAD_BASE_DIR = PORTAL_DIR.parent / "uploads" / "customer_documents"
UPLOAD_BASE_DIR.mkdir(parents=True, exist_ok=True)

templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

# DB Connection Config
import sys
if str(PORTAL_DIR.parent) not in sys.path:
    sys.path.insert(0, str(PORTAL_DIR.parent))
from db_config import DB_CONN_STR

def get_db_connection():
    return pyodbc.connect(DB_CONN_STR)

def execute_query(query: str, params: tuple = ()) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(query, params)
        if cursor.description:
            columns = [column[0] for column in cursor.description]
            rows = cursor.fetchall()
            result = []
            for row in rows:
                d = {}
                for col, val in zip(columns, row):
                    if isinstance(val, (datetime.datetime, datetime.date, datetime.time)):
                        d[col] = val.isoformat() if hasattr(val, 'isoformat') else str(val)
                    elif isinstance(val, (bytes, bytearray)):
                        d[col] = "<binary data>"
                    else:
                        d[col] = val
                result.append(d)
            return result
        conn.commit()
        return []
    finally:
        cursor.close()
        conn.close()

def execute_non_query(query: str, params: tuple = ()) -> int:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(query, params)
        conn.commit()
        return cursor.rowcount
    finally:
        cursor.close()
        conn.close()

def is_mobile_user_agent(request: Request) -> bool:
    ua = request.headers.get("User-Agent", "").lower()
    mobile_keywords = [
        "mobile", "android", "iphone", "ipad", "ipod", 
        "blackberry", "windows phone", "opera mini", "iemobile", "webos"
    ]
    return any(k in ua for k in mobile_keywords)

def get_email_settings() -> Dict[str, Any]:
    """Retrieve SMTP configuration from tbl_Emails or tbl_Emailer."""
    try:
        rows = execute_query("SELECT TOP 1 EmailAddress, EmailPass, EmailServer, ISNULL(Port, 587) as Port FROM dbo.tbl_Emails")
        if rows and rows[0].get("EmailAddress"):
            return {
                "server": str(rows[0]["EmailServer"]).strip(),
                "port": int(rows[0].get("Port") or 587),
                "email": str(rows[0]["EmailAddress"]).strip(),
                "password": str(rows[0]["EmailPass"]).strip()
            }
    except Exception as e:
        print(f"Error fetching from tbl_Emails: {e}")

    try:
        rows = execute_query("SELECT TOP 1 EmailAddress, EmailPass, EmailServer FROM dbo.tbl_Emailer")
        if rows and rows[0].get("EmailAddress"):
            return {
                "server": str(rows[0]["EmailServer"]).strip(),
                "port": 587,
                "email": str(rows[0]["EmailAddress"]).strip(),
                "password": str(rows[0]["EmailPass"]).strip()
            }
    except Exception as e:
        print(f"Error fetching from tbl_Emailer: {e}")

    # Default fallback
    return {
        "server": "exmail2.work",
        "port": 587,
        "email": "support@serenetech.co.za",
        "password": "SupSer@234"
    }

def send_otp_email(to_email: str, recipient_name: str, otp_code: str) -> bool:
    """
    Send OTP email securely using tbl_Emails settings via SMTP Port 587 (STARTTLS).
    Strictly sends ONLY to the logging-in customer email.
    """
    settings = get_email_settings()
    smtp_server = settings["server"]
    smtp_port = settings["port"]
    smtp_user = settings["email"]
    smtp_pass = settings["password"]

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Approven Customer Portal - Your Login Code: {otp_code}"
    msg["From"] = formataddr(("Approven Customer Portal", smtp_user))
    msg["To"] = to_email

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; margin: 0; padding: 20px; }}
        .container {{ max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }}
        .header {{ background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 28px 24px; text-align: center; }}
        .header h1 {{ color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 0.5px; }}
        .header p {{ color: #94a3b8; margin: 6px 0 0 0; font-size: 13px; }}
        .content {{ padding: 32px 28px; color: #1e293b; }}
        .greeting {{ font-size: 16px; font-weight: 600; color: #0f172a; margin-bottom: 12px; }}
        .intro {{ font-size: 14px; color: #475569; line-height: 1.6; margin-bottom: 24px; }}
        .otp-box {{ background: #f8fafc; border: 2px dashed #0284c7; border-radius: 10px; padding: 20px; text-align: center; margin: 24px 0; }}
        .otp-label {{ font-size: 12px; font-weight: 700; text-transform: uppercase; color: #0284c7; letter-spacing: 1px; margin-bottom: 8px; }}
        .otp-code {{ font-size: 38px; font-weight: 800; color: #0f172a; letter-spacing: 8px; font-family: Consolas, 'Courier New', monospace; }}
        .note {{ font-size: 13px; color: #64748b; line-height: 1.5; border-top: 1px solid #f1f5f9; padding-top: 16px; margin-top: 24px; }}
        .footer {{ background: #f8fafc; padding: 18px 24px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }}
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Approven</h1>
          <p>Certification Body Customer Portal</p>
        </div>
        <div class="content">
          <div class="greeting">Hello {recipient_name},</div>
          <p class="intro">You requested access to the Approven Customer Portal. Please use the one-time verification code below to securely sign in to your account:</p>
          <div class="otp-box">
            <div class="otp-label">One-Time Login Code</div>
            <div class="otp-code">{otp_code}</div>
          </div>
          <p class="note">
            ⏱️ <strong>This code is valid for 15 minutes</strong> and can only be used once.<br>
            🔒 For security reasons, do not share this code with anyone.<br>
            If you did not request this login code, you can safely ignore this email.
          </p>
        </div>
        <div class="footer">
          &copy; {datetime.datetime.now().year} Approven Partners LLP. All rights reserved.
        </div>
      </div>
    </body>
    </html>
    """

    text_content = f"Approven Customer Portal Login\n\nHello {recipient_name},\n\nYour one-time login verification code is: {otp_code}\n\nThis code expires in 15 minutes.\n\nApproven Partners LLP"

    msg.attach(MIMEText(text_content, "plain"))
    msg.attach(MIMEText(html_content, "html"))

    try:
        server = smtplib.SMTP(smtp_server, smtp_port, timeout=12)
        server.ehlo()
        server.starttls()
        server.ehlo()
        server.login(smtp_user, smtp_pass)
        server.sendmail(smtp_user, [to_email], msg.as_string())
        server.quit()
        print(f"OTP successfully sent to {to_email}")
        return True
    except Exception as e:
        print(f"Failed to send OTP to {to_email}: {e}")
        return False

def get_current_customer(request: Request) -> Dict[str, Any]:
    """Dependency to get authenticated customer from session."""
    user = request.session.get("customer_user")
    if not user or not user.get("cb_id"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired or not logged in. Please authenticate via OTP."
        )
    return user

# ==============================================================================
# UI Pages Routes & PWA Handlers
# ==============================================================================

@customerportal_router.get("/manifest.json")
async def portal_manifest():
    manifest_file = STATIC_DIR / "manifest.json"
    return FileResponse(path=str(manifest_file), media_type="application/manifest+json")

@customerportal_router.get("/sw.js")
async def portal_service_worker():
    sw_file = STATIC_DIR / "sw.js"
    return FileResponse(
        path=str(sw_file),
        media_type="application/javascript",
        headers={"Service-Worker-Allowed": "/customerportal", "Cache-Control": "no-cache"}
    )

@customerportal_router.get("", response_class=HTMLResponse)
@customerportal_router.get("/", response_class=HTMLResponse)
async def portal_root(request: Request, view: Optional[str] = Query(None)):
    user = request.session.get("customer_user")
    is_mobile = is_mobile_user_agent(request)
    
    # Check if mobile redirection is requested
    if is_mobile and view != "desktop":
        return RedirectResponse(url="/customerportal/m")
        
    if not user:
        return RedirectResponse(url="/customerportal/login")
        
    cache_buster = int(time.time())
    return templates.TemplateResponse(
        request=request,
        name="portal.html",
        context={"user": user, "cache_buster": cache_buster, "is_mobile": False}
    )

@customerportal_router.get("/m", response_class=HTMLResponse)
async def mobile_portal_root(request: Request):
    user = request.session.get("customer_user")
    if not user:
        return RedirectResponse(url="/customerportal/m/login")
        
    cache_buster = int(time.time())
    return templates.TemplateResponse(
        request=request,
        name="mobile_portal.html",
        context={"user": user, "cache_buster": cache_buster, "is_mobile": True}
    )

@customerportal_router.get("/login", response_class=HTMLResponse)
async def login_view(request: Request, view: Optional[str] = Query(None)):
    user = request.session.get("customer_user")
    is_mobile = is_mobile_user_agent(request)
    
    if is_mobile and view != "desktop":
        return RedirectResponse(url="/customerportal/m/login")
        
    if user:
        return RedirectResponse(url="/customerportal")
        
    cache_buster = int(time.time())
    return templates.TemplateResponse(
        request=request,
        name="login.html",
        context={"cache_buster": cache_buster, "is_mobile": False}
    )

@customerportal_router.get("/m/login", response_class=HTMLResponse)
async def mobile_login_view(request: Request):
    user = request.session.get("customer_user")
    if user:
        return RedirectResponse(url="/customerportal/m")
        
    cache_buster = int(time.time())
    return templates.TemplateResponse(
        request=request,
        name="mobile_login.html",
        context={"cache_buster": cache_buster, "is_mobile": True}
    )

@customerportal_router.get("/logout")
async def logout(request: Request):
    request.session.pop("customer_user", None)
    is_mobile = is_mobile_user_agent(request)
    target = "/customerportal/m/login" if is_mobile else "/customerportal/login"
    return RedirectResponse(url=target, status_code=status.HTTP_302_FOUND)

# ==============================================================================
# Authentication / OTP APIs
# ==============================================================================

@customerportal_router.post("/api/request-otp")
async def api_request_otp(request: Request, email: str = Form(...)):
    clean_email = email.strip().lower()
    if not clean_email or "@" not in clean_email:
        return JSONResponse(
            status_code=400,
            content={"success": False, "message": "Please provide a valid email address."}
        )

    # 1. Verify email exists in Billing_Email of tbl_Certification_Bodies
    query = """
        SELECT ID, Company_Name, Customer_Number, Code, Billing_Contact_Name, Billing_Email, Status
        FROM dbo.tbl_Certification_Bodies
        WHERE LOWER(LTRIM(RTRIM(Billing_Email))) = LOWER(?)
    """
    cbs = execute_query(query, (clean_email,))
    
    if not cbs:
        return JSONResponse(
            status_code=404,
            content={
                "success": False,
                "message": "No active Certification Body account was found matching this billing email address. Please contact Approven support."
            }
        )

    cb = cbs[0]
    recipient_name = cb.get("Billing_Contact_Name") or cb.get("Company_Name") or "Valued Customer"

    # 2. Generate 6-digit OTP
    otp_code = f"{random.randint(100000, 999999)}"

    # 3. Store in tbl_Portal_OTP with 15 minutes expiry
    # Expire old unused OTPs for this email
    execute_non_query(
        "UPDATE dbo.tbl_Portal_OTP SET Used = 1 WHERE LOWER(Email) = LOWER(?) AND Used = 0",
        (clean_email,)
    )

    # Insert new OTP record
    execute_non_query(
        """
        INSERT INTO dbo.tbl_Portal_OTP (Email, OTP, ExpiresAt, Used, CreatedAt, Attempts)
        VALUES (?, ?, DATEADD(minute, 15, GETDATE()), 0, GETDATE(), 0)
        """,
        (clean_email, otp_code)
    )

    # 4. Dispatch Email strictly to clean_email
    email_sent = send_otp_email(to_email=clean_email, recipient_name=recipient_name, otp_code=otp_code)
    if not email_sent:
        return JSONResponse(
            status_code=500,
            content={"success": False, "message": "Failed to dispatch verification email. Please try again or contact support."}
        )

    # Mask email for user friendly display
    parts = clean_email.split("@")
    masked_email = parts[0][:2] + "***@" + parts[1] if len(parts[0]) > 2 else clean_email

    return {
        "success": True,
        "message": f"A 6-digit verification code has been sent to {masked_email}.",
        "company_name": cb["Company_Name"]
    }

@customerportal_router.post("/api/verify-otp")
async def api_verify_otp(request: Request, email: str = Form(...), otp: str = Form(...)):
    clean_email = email.strip().lower()
    clean_otp = otp.strip()

    if not clean_email or not clean_otp:
        return JSONResponse(
            status_code=400,
            content={"success": False, "message": "Email and verification code are required."}
        )

    # 1. Look up active OTP record
    query_otp = """
        SELECT TOP 1 ID, OTP, ExpiresAt, Attempts
        FROM dbo.tbl_Portal_OTP
        WHERE LOWER(Email) = LOWER(?) AND Used = 0 AND ExpiresAt >= GETDATE()
        ORDER BY CreatedAt DESC
    """
    rows = execute_query(query_otp, (clean_email,))

    if not rows:
        return JSONResponse(
            status_code=401,
            content={"success": False, "message": "Verification code has expired or is invalid. Please request a new one."}
        )

    otp_record = rows[0]
    record_id = otp_record["ID"]
    saved_otp = str(otp_record["OTP"]).strip()
    attempts = otp_record.get("Attempts", 0)

    if attempts >= 5:
        execute_non_query("UPDATE dbo.tbl_Portal_OTP SET Used = 1 WHERE ID = ?", (record_id,))
        return JSONResponse(
            status_code=429,
            content={"success": False, "message": "Too many failed attempts. Please request a new verification code."}
        )

    if clean_otp != saved_otp:
        execute_non_query("UPDATE dbo.tbl_Portal_OTP SET Attempts = Attempts + 1 WHERE ID = ?", (record_id,))
        return JSONResponse(
            status_code=401,
            content={"success": False, "message": "Incorrect verification code. Please check and try again."}
        )

    # 2. Mark OTP as used
    execute_non_query("UPDATE dbo.tbl_Portal_OTP SET Used = 1 WHERE ID = ?", (record_id,))

    # 3. Retrieve CB Details
    cb_rows = execute_query(
        """
        SELECT ID, Company_Name, Customer_Number, Code, Billing_Contact_Name, Billing_Email,
               Billing_Physical_Address, Billing_Country, Billing_Tel, Status
        FROM dbo.tbl_Certification_Bodies
        WHERE LOWER(LTRIM(RTRIM(Billing_Email))) = LOWER(?)
        """,
        (clean_email,)
    )

    if not cb_rows:
        return JSONResponse(
            status_code=404,
            content={"success": False, "message": "Certification Body profile not found."}
        )

    cb = cb_rows[0]

    # 4. Create Customer User Session
    session_data = {
        "cb_id": cb["ID"],
        "company_name": cb["Company_Name"],
        "customer_number": cb.get("Customer_Number") or "",
        "code": cb.get("Code") or "",
        "billing_email": cb["Billing_Email"],
        "contact_name": cb.get("Billing_Contact_Name") or cb["Company_Name"],
        "country": cb.get("Billing_Country") or "",
        "logged_in_at": int(time.time())
    }
    request.session["customer_user"] = session_data

    is_mobile = is_mobile_user_agent(request)
    redirect_target = "/customerportal/m" if is_mobile else "/customerportal"

    return {
        "success": True,
        "redirect": redirect_target,
        "user": session_data
    }

@customerportal_router.get("/api/auth-status")
async def api_auth_status(request: Request):
    user = request.session.get("customer_user")
    if not user or not user.get("cb_id"):
        return JSONResponse(status_code=401, content={"authenticated": False})
    return {"authenticated": True, "user": user}

# ==============================================================================
# Customer Portal Data APIs (Strictly Scoped to Authenticated CB)
# ==============================================================================

@customerportal_router.get("/api/summary")
async def api_summary(user: Dict[str, Any] = Depends(get_current_customer)):
    cb_id = user["cb_id"]
    
    # Summary KPI Stats
    stats = {}
    try:
        # Quotes stats
        q_stats = execute_query(
            """
            SELECT 
                COUNT(q.QuoteID) as total_quotes,
                ISNULL(SUM(CASE WHEN q.Quote_Status = 'Accepted' THEN 1 ELSE 0 END), 0) as accepted_quotes,
                ISNULL(SUM(CASE WHEN q.Quote_Status IN ('Preparing', 'Sent to Client') THEN 1 ELSE 0 END), 0) as pending_quotes,
                ISNULL(SUM(q.Quote_SubTotal), 0) as total_quoted_value
            FROM dbo.tbl_Quoting q
            INNER JOIN dbo.tbl_WorkflowProcess wf ON q.WFID = wf.WFID
            WHERE (wf.Certification_Body = ? OR q.CB = ?) AND wf.Status <> 'Cancelled'
            """,
            (cb_id, cb_id)
        )
        if q_stats:
            stats.update(q_stats[0])

        # Audits stats
        a_stats = execute_query(
            """
            SELECT 
                COUNT(wf.WFID) as total_audits,
                ISNULL(SUM(CASE WHEN wf.Status = 'Confirmed' THEN 1 ELSE 0 END), 0) as confirmed_audits,
                ISNULL(SUM(CASE WHEN wf.Status = 'Complete' THEN 1 ELSE 0 END), 0) as complete_audits,
                ISNULL(SUM(CASE WHEN wf.Status = 'Pending' THEN 1 ELSE 0 END), 0) as pending_audits
            FROM dbo.tbl_WorkflowProcess wf
            WHERE wf.Certification_Body = ? AND wf.Status <> 'Cancelled'
            """,
            (cb_id,)
        )
        if a_stats:
            stats.update(a_stats[0])

        # Documents stats
        d_stats = execute_query(
            """
            SELECT COUNT(DocumentID) as total_documents
            FROM dbo.tbl_Customer_Documents
            WHERE CBID = ? AND IsActive = 1
            """,
            (cb_id,)
        )
        if d_stats:
            stats.update(d_stats[0])

    except Exception as e:
        print(f"Error calculating customer summary: {e}")
        stats = {
            "total_quotes": 0, "accepted_quotes": 0, "pending_quotes": 0, "total_quoted_value": 0,
            "total_audits": 0, "confirmed_audits": 0, "complete_audits": 0, "pending_audits": 0,
            "total_documents": 0
        }

    return {"success": True, "stats": stats, "user": user}

@customerportal_router.get("/api/quotes")
async def api_quotes(
    status: Optional[str] = None,
    search: Optional[str] = None,
    user: Dict[str, Any] = Depends(get_current_customer)
):
    cb_id = user["cb_id"]
    
    where_clauses = ["(wf.Certification_Body = ? OR q.CB = ?)"]
    params: List[Any] = [cb_id, cb_id]

    if status and status.strip() and status != "All":
        where_clauses.append("q.Quote_Status = ?")
        params.append(status.strip())

    if search and search.strip():
        term = f"%{search.strip()}%"
        where_clauses.append("(q.QuoteRef LIKE ? OR a.Company_Name LIKE ? OR wf.Audit_Program LIKE ? OR q.Reference LIKE ?)")
        params.extend([term, term, term, term])

    where_sql = " AND ".join(where_clauses)
    
    query = f"""
        SELECT 
            q.QuoteID, q.WFID, q.QuoteRef, q.Reference, q.PO_Number,
            q.Quote_Created, q.Quote_ValidTo, q.Quote_SubTotal, q.Quote_VAT, q.Quote_Total,
            q.Quote_Status, q.Quote_Overview, q.Date_Submitted, q.Outcome_Date,
            q.Discount, q.Comments,
            wf.Project_Nr, wf.Audit_Program, wf.Audit_Type, 
            wf.Audit_Start_Date, wf.Audit_End_Date, wf.Status as Audit_Status,
            a.Company_Name as Auditee_Name, a.Country as Auditee_Country, a.ContactName as Auditee_Contact
        FROM dbo.tbl_Quoting q
        INNER JOIN dbo.tbl_WorkflowProcess wf ON q.WFID = wf.WFID
        LEFT JOIN dbo.tbl_Auditees a ON wf.AuditeeID = a.ID
        WHERE {where_sql}
        ORDER BY q.Quote_Created DESC, q.QuoteID DESC
    """
    
    quotes = execute_query(query, tuple(params))
    return {"success": True, "count": len(quotes), "quotes": quotes}

@customerportal_router.get("/api/quotes/{quote_id}")
async def api_quote_detail(
    quote_id: int,
    user: Dict[str, Any] = Depends(get_current_customer)
):
    cb_id = user["cb_id"]
    query = """
        SELECT 
            q.QuoteID, q.WFID, q.QuoteRef, q.Reference, q.PO_Number,
            q.Quote_Created, q.Quote_ValidTo, q.Quote_SubTotal, q.Quote_VAT, q.Quote_Total,
            q.Quote_Status, q.Quote_Overview, q.Date_Submitted, q.Outcome_Date,
            q.Discount, q.Comments,
            wf.Project_Nr, wf.Audit_Program, wf.Audit_Type, 
            wf.Audit_Start_Date, wf.Audit_End_Date, wf.Status as Audit_Status,
            wf.Total_Mandays, wf.Nr_Sites, wf.Cert_Type_Standard,
            a.Company_Name as Auditee_Name, a.Address as Auditee_Address,
            a.Country as Auditee_Country, a.ContactName as Auditee_Contact,
            a.Tel as Auditee_Tel, a.Email as Auditee_Email
        FROM dbo.tbl_Quoting q
        INNER JOIN dbo.tbl_WorkflowProcess wf ON q.WFID = wf.WFID
        LEFT JOIN dbo.tbl_Auditees a ON wf.AuditeeID = a.ID
        WHERE q.QuoteID = ? AND (wf.Certification_Body = ? OR q.CB = ?)
    """
    rows = execute_query(query, (quote_id, cb_id, cb_id))
    if not rows:
        raise HTTPException(status_code=404, detail="Quote not found or access denied")
    return {"success": True, "quote": rows[0]}

@customerportal_router.get("/api/audits")
async def api_audits(
    status: Optional[str] = None,
    program: Optional[str] = None,
    search: Optional[str] = None,
    user: Dict[str, Any] = Depends(get_current_customer)
):
    cb_id = user["cb_id"]
    
    where_clauses = ["wf.Certification_Body = ?"]
    params: List[Any] = [cb_id]

    if status and status.strip() and status != "All":
        where_clauses.append("wf.Status = ?")
        params.append(status.strip())

    if program and program.strip() and program != "All":
        where_clauses.append("wf.Audit_Program = ?")
        params.append(program.strip())

    if search and search.strip():
        term = f"%{search.strip()}%"
        where_clauses.append("(wf.Project_Nr LIKE ? OR a.Company_Name LIKE ? OR wf.Audit_Program LIKE ? OR s.SiteName LIKE ?)")
        params.extend([term, term, term, term])

    where_sql = " AND ".join(where_clauses)

    query = f"""
        SELECT 
            wf.WFID, wf.Project_Nr, wf.Status, wf.Audit_Program, wf.Audit_Type,
            wf.Audit_Start_Date, wf.Audit_End_Date, wf.Audit_Deadline,
            wf.Audit_Confirmed, wf.Audit_Dates_Confirmed,
            wf.Announcement, wf.Cert_Type_Standard, wf.Total_Mandays,
            wf.Amount_Quoted, wf.Invoice_Nr, wf.Invoice_Amount,
            a.Company_Name as Auditee_Name, a.Address as Auditee_Address, a.Country as Auditee_Country,
            a.ContactName as Auditee_Contact, a.Email as Auditee_Email, a.Tel as Auditee_Tel,
            s.SiteName as Site_Name, s.Address as Site_Address, s.Country as Site_Country
        FROM dbo.tbl_WorkflowProcess wf
        LEFT JOIN dbo.tbl_Auditees a ON wf.AuditeeID = a.ID
        LEFT JOIN dbo.tbl_AuditeeSites s ON wf.SiteID = s.ID
        WHERE {where_sql}
        ORDER BY COALESCE(wf.Audit_Start_Date, wf.AuditWindow_From, wf.Created_Date) DESC, wf.WFID DESC
    """

    audits = execute_query(query, tuple(params))
    return {"success": True, "count": len(audits), "audits": audits}

@customerportal_router.get("/api/audits/{wfid}")
async def api_audit_detail(
    wfid: int,
    user: Dict[str, Any] = Depends(get_current_customer)
):
    cb_id = user["cb_id"]
    query = """
        SELECT 
            wf.WFID, wf.Project_Nr, wf.Status, wf.Audit_Program, wf.Audit_Type,
            wf.Audit_Start_Date, wf.Audit_End_Date, wf.Audit_Deadline,
            wf.Audit_Confirmed, wf.Audit_Dates_Confirmed,
            wf.Announcement, wf.Cert_Type_Standard, wf.Total_Mandays,
            wf.Amount_Quoted, wf.Invoice_Nr, wf.Invoice_Amount,
            wf.Purchase_Ord_Nr, wf.Proforma_InvNr, wf.Proforma_Amount,
            wf.NonAnn_Window_Type, wf.NonAnn_Window_Period,
            a.Company_Name as Auditee_Name, a.Address as Auditee_Address, a.Country as Auditee_Country,
            a.ContactName as Auditee_Contact, a.Email as Auditee_Email, a.Tel as Auditee_Tel,
            s.SiteName as Site_Name, s.Address as Site_Address, s.Country as Site_Country
        FROM dbo.tbl_WorkflowProcess wf
        LEFT JOIN dbo.tbl_Auditees a ON wf.AuditeeID = a.ID
        LEFT JOIN dbo.tbl_AuditeeSites s ON wf.SiteID = s.ID
        WHERE wf.WFID = ? AND wf.Certification_Body = ?
    """
    rows = execute_query(query, (wfid, cb_id))
    if not rows:
        raise HTTPException(status_code=404, detail="Audit not found or access denied")
    return {"success": True, "audit": rows[0]}

@customerportal_router.get("/api/profile")
async def api_profile(user: Dict[str, Any] = Depends(get_current_customer)):
    cb_id = user["cb_id"]
    query = """
        SELECT 
            ID, Status, Company_Name, Customer_Number, Code,
            Billing_Physical_Address, Billing_Country, Billing_Contact_Name,
            Billing_Email, Billing_Tel, Comments,
            Man_Day_Rate, Per_KM_Rate, Travel_Time_Rate_perHour, Hotel_perNight_Rate,
            Report_Fee, Quote_Terms
        FROM dbo.tbl_Certification_Bodies
        WHERE ID = ?
    """
    rows = execute_query(query, (cb_id,))
    if not rows:
        raise HTTPException(status_code=404, detail="Profile not found")
    return {"success": True, "profile": rows[0]}

# ==============================================================================
# Document Management APIs
# ==============================================================================

@customerportal_router.get("/api/documents")
async def api_list_documents(
    doc_type: Optional[str] = None,
    search: Optional[str] = None,
    user: Dict[str, Any] = Depends(get_current_customer)
):
    cb_id = user["cb_id"]
    
    where_clauses = ["d.CBID = ?", "d.IsActive = 1"]
    params: List[Any] = [cb_id]

    if doc_type and doc_type.strip() and doc_type != "All":
        where_clauses.append("d.DocumentType = ?")
        params.append(doc_type.strip())

    if search and search.strip():
        term = f"%{search.strip()}%"
        where_clauses.append("(d.FileName LIKE ? OR d.Description LIKE ? OR d.UploadedBy LIKE ?)")
        params.extend([term, term, term])

    where_sql = " AND ".join(where_clauses)

    query = f"""
        SELECT 
            d.DocumentID, d.CBID, d.FileName, d.StoredFileName, d.FileType, d.FileSize,
            d.DocumentType, d.WFID, d.Description, d.UploadedBy, d.UploadedAt,
            wf.Project_Nr, a.Company_Name as Auditee_Name
        FROM dbo.tbl_Customer_Documents d
        LEFT JOIN dbo.tbl_WorkflowProcess wf ON d.WFID = wf.WFID
        LEFT JOIN dbo.tbl_Auditees a ON wf.AuditeeID = a.ID
        WHERE {where_sql}
        ORDER BY d.UploadedAt DESC
    """
    documents = execute_query(query, tuple(params))
    return {"success": True, "count": len(documents), "documents": documents}

@customerportal_router.post("/api/documents/upload")
async def api_upload_document(
    file: UploadFile = File(...),
    document_type: str = Form("General Document"),
    wfid: Optional[str] = Form(None),
    description: Optional[str] = Form(""),
    user: Dict[str, Any] = Depends(get_current_customer)
):
    cb_id = user["cb_id"]
    uploaded_by = user.get("billing_email") or user.get("contact_name") or "Portal User"

    if not file.filename:
        return JSONResponse(status_code=400, content={"success": False, "message": "No file selected."})

    # Validate file size (max 30MB)
    contents = await file.read()
    file_size = len(contents)
    if file_size > 30 * 1024 * 1024:
        return JSONResponse(status_code=400, content={"success": False, "message": "File exceeds maximum 30MB limit."})

    # Prepare storage directory
    cb_dir = UPLOAD_BASE_DIR / str(cb_id)
    cb_dir.mkdir(parents=True, exist_ok=True)

    original_name = file.filename
    clean_name = re.sub(r'[^a-zA-Z0-9_.-]', '_', original_name)
    unique_suffix = uuid.uuid4().hex[:10]
    stored_name = f"{cb_id}_{unique_suffix}_{clean_name}"
    target_path = cb_dir / stored_name

    # Save to disk
    with open(target_path, "wb") as f:
        f.write(contents)

    # Optional WFID
    parsed_wfid = None
    if wfid and str(wfid).strip().isdigit():
        parsed_wfid = int(str(wfid).strip())

    # Insert DB record
    query = """
        INSERT INTO dbo.tbl_Customer_Documents (
            CBID, FileName, StoredFileName, FilePath, FileType, FileSize,
            DocumentType, WFID, Description, UploadedBy, UploadedAt, IsActive
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), 1)
    """
    execute_non_query(
        query,
        (
            cb_id,
            original_name,
            stored_name,
            str(target_path),
            file.content_type or "application/octet-stream",
            file_size,
            document_type.strip() if document_type else "General Document",
            parsed_wfid,
            description.strip() if description else None,
            uploaded_by
        )
    )

    return {
        "success": True,
        "message": f"Document '{original_name}' uploaded successfully!",
        "filename": original_name,
        "filesize": file_size
    }

@customerportal_router.get("/api/documents/{doc_id}/download")
async def api_download_document(
    doc_id: int,
    user: Dict[str, Any] = Depends(get_current_customer)
):
    cb_id = user["cb_id"]
    query = """
        SELECT DocumentID, CBID, FileName, StoredFileName, FilePath, FileType
        FROM dbo.tbl_Customer_Documents
        WHERE DocumentID = ? AND CBID = ? AND IsActive = 1
    """
    rows = execute_query(query, (doc_id, cb_id))
    if not rows:
        raise HTTPException(status_code=404, detail="Document not found or access denied")

    doc = rows[0]
    file_path = Path(doc["FilePath"])
    if not file_path.exists():
        # Check in UPLOAD_BASE_DIR / str(cb_id) / doc['StoredFileName']
        fallback_path = UPLOAD_BASE_DIR / str(cb_id) / doc["StoredFileName"]
        if fallback_path.exists():
            file_path = fallback_path
        else:
            raise HTTPException(status_code=404, detail="File content not found on server")

    return FileResponse(
        path=str(file_path),
        filename=doc["FileName"],
        media_type=doc.get("FileType") or "application/octet-stream"
    )

@customerportal_router.delete("/api/documents/{doc_id}")
async def api_delete_document(
    doc_id: int,
    user: Dict[str, Any] = Depends(get_current_customer)
):
    cb_id = user["cb_id"]
    rows = execute_query(
        "SELECT DocumentID, FilePath FROM dbo.tbl_Customer_Documents WHERE DocumentID = ? AND CBID = ?",
        (doc_id, cb_id)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Document not found or access denied")

    # Soft delete in DB
    execute_non_query(
        "UPDATE dbo.tbl_Customer_Documents SET IsActive = 0 WHERE DocumentID = ? AND CBID = ?",
        (doc_id, cb_id)
    )

    return {"success": True, "message": "Document deleted successfully"}
