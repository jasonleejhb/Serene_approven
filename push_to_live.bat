@echo off
title Push Approven Dev to Live
echo ========================================================
echo Pushing Approven Dev to Live folder...
echo ========================================================

set "SRC=C:\Apps\Approven\Dev"
set "DEST=C:\Apps\Approven\Live"

if not exist "%DEST%" mkdir "%DEST%"

echo Copying main Python scripts and configuration...
robocopy "%SRC%" "%DEST%" main.py db_config.py sync_data.py "ApprovenLinkedLiveTables.accdb" "Approven v0.40.accdb" "Approven_Serenity_be.accdb" "Logo Login Screen Homepage.jpg" "Logo Lrg White Background2.jpg" /R:2 /W:1 /NDL /NFL

echo Copying CustomerPortal directory...
if not exist "%DEST%\CustomerPortal" mkdir "%DEST%\CustomerPortal"
robocopy "%SRC%\CustomerPortal" "%DEST%\CustomerPortal" /E /XD __pycache__ /R:2 /W:1 /NDL /NFL

echo Copying Mobile directory...
if not exist "%DEST%\Mobile" mkdir "%DEST%\Mobile"
robocopy "%SRC%\Mobile" "%DEST%\Mobile" /E /XD __pycache__ /R:2 /W:1 /NDL /NFL

echo Copying templates directory...
if not exist "%DEST%\templates" mkdir "%DEST%\templates"
robocopy "%SRC%\templates" "%DEST%\templates" /E /R:2 /W:1 /NDL /NFL

echo Copying static assets directory...
if not exist "%DEST%\static" mkdir "%DEST%\static"
robocopy "%SRC%\static" "%DEST%\static" /E /XD __pycache__ /R:2 /W:1 /NDL /NFL

echo.
echo ========================================================
echo Push to Live Completed Successfully!
echo Note: Run Live\restart_live.bat if the Live server is running.
echo ========================================================
pause
