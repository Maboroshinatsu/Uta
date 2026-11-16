@echo off
setlocal
set "UTA_PROFILE=pet-qoder"
set "UTA_BOUND_HOST=qoder"
set "UTA_USER_DATA_DIR=%LOCALAPPDATA%\Uta-Pets\qoder"
set "UTA_RUNTIME_DIR=%UTA_USER_DATA_DIR%"
set "UTA_ENDPOINT_FILE=%UTA_USER_DATA_DIR%\runtime-endpoint.json"
start "Uta Qoder" "%~dp0..\Uta.exe"
endlocal
