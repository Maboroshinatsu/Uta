@echo off
setlocal
set "UTA_PROFILE=pet-codex"
set "UTA_BOUND_HOST=codex"
set "UTA_USER_DATA_DIR=%LOCALAPPDATA%\Uta-Pets\codex"
set "UTA_RUNTIME_DIR=%UTA_USER_DATA_DIR%"
set "UTA_ENDPOINT_FILE=%UTA_USER_DATA_DIR%\runtime-endpoint.json"
start "Uta Codex" "%~dp0..\Uta.exe"
endlocal
