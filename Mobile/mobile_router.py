import os
import time
from typing import Optional, List
from fastapi import APIRouter, Request, Form, Depends, HTTPException, status
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates
import pyodbc

# Setup paths
MOBILE_DIR = os.path.dirname(os.path.abspath(__file__))
templates = Jinja2Templates(directory=os.path.join(MOBILE_DIR, "templates"))

# DB Connection Helper
import sys
_PARENT_DIR = os.path.dirname(MOBILE_DIR)
if _PARENT_DIR not in sys.path:
    sys.path.insert(0, _PARENT_DIR)
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

mobile_router = APIRouter()

@mobile_router.get("", response_class=HTMLResponse)
@mobile_router.get("/", response_class=HTMLResponse)
async def mobile_index(request: Request):
    user = request.session.get("user")
    if not user:
        return RedirectResponse(url="/m/login")
    cache_buster = int(time.time())
    response = templates.TemplateResponse(
        request=request,
        name="index.html",
        context={
            "user": user,
            "countries": get_countries_list(),
            "cache_buster": cache_buster,
            "is_mobile": True
        }
    )
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

@mobile_router.get("/login", response_class=HTMLResponse)
async def mobile_login_page(request: Request):
    user = request.session.get("user")
    if user:
        return RedirectResponse(url="/m")
    cache_buster = int(time.time())
    return templates.TemplateResponse(
        request=request,
        name="login.html",
        context={"error": None, "cache_buster": cache_buster}
    )

@mobile_router.post("/api/login")
async def mobile_api_login(request: Request, username: str = Form(...), password: str = Form(...)):
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
    
    return {"success": True, "redirect": "/m"}

@mobile_router.get("/logout")
async def mobile_logout(request: Request):
    request.session.clear()
    return RedirectResponse(url="/m/login", status_code=status.HTTP_302_FOUND)
