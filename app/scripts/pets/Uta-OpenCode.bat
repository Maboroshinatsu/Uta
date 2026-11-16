@echo off
setlocal
set "UTA_PROFILE=pet-opencode"
set "UTA_BOUND_HOST=opencode"
set "UTA_USER_DATA_DIR=%LOCALAPPDATA%\Uta-Pets\opencode"
set "UTA_RUNTIME_DIR=%UTA_USER_DATA_DIR%"
set "UTA_ENDPOINT_FILE=%UTA_USER_DATA_DIR%\runtime-endpoint.json"
start "Uta OpenCode" "%~dp0..\Uta.exe"
endlocal
