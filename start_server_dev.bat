@echo off
title Approven DEV Web Server (localhost:8000)
echo ========================================================
echo Starting Approven DEV Web Server on http://localhost:8000
echo ========================================================
cd /d "%~dp0"

python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload

echo.
echo Server has stopped.
pause
