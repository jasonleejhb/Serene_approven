@echo off
title Approven Data Sync (Access Live -> SQL Server)
echo ======================================================================
echo   APPROVEN DATA SYNCHRONIZATION
echo   From: ApprovenLinkedLiveTables.accdb (ReadOnly)
echo   To:   SQL Server Database "Approven_Dev"
echo ======================================================================
echo.

cd /d "%~dp0"
python sync_data.py

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ======================================================================
    echo   [SUCCESS] Data synchronization completed successfully!
    echo ======================================================================
) else (
    echo.
    echo ======================================================================
    echo   [ERROR] Data synchronization encountered an error (Exit Code: %ERRORLEVEL%).
    echo ======================================================================
)

echo.
pause
