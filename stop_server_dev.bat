@echo off
title Stop Approven DEV Server (port 8000)
echo Stopping Approven DEV server on port 8000...

powershell -NoProfile -InputFormat None -Command "$killed = @(); $procs = Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'python*' -and $_.CommandLine -match 'uvicorn' -and $_.CommandLine -match '8000' }; foreach ($p in $procs) { taskkill /F /T /PID $p.ProcessId 2>$null | Out-Null; $killed += $p.ProcessId }; $conns = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue; foreach ($c in $conns) { if ($c.OwningProcess -gt 0 -and $killed -notcontains $c.OwningProcess) { taskkill /F /T /PID $c.OwningProcess 2>$null | Out-Null; $killed += $c.OwningProcess } }; if ($killed.Count -gt 0) { Write-Output ('Stopped PID(s): ' + ($killed -join ', ')) } else { Write-Output 'No DEV server found running on port 8000.' }"

pause
