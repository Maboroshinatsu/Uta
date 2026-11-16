@echo off
setlocal
set "UTA_PROFILE=pet-antigravity"
set "UTA_BOUND_HOST=antigravity"
set "UTA_USER_DATA_DIR=%LOCALAPPDATA%\Uta-Pets\antigravity"
set "UTA_RUNTIME_DIR=%UTA_USER_DATA_DIR%"
set "UTA_ENDPOINT_FILE=%UTA_USER_DATA_DIR%\runtime-endpoint.json"
start "Uta Antigravity" "%~dp0..\Uta.exe"
endlocal
