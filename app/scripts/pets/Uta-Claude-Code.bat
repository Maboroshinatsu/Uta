@echo off
setlocal
set "UTA_PROFILE=pet-claude-code"
set "UTA_BOUND_HOST=claude-code"
set "UTA_USER_DATA_DIR=%LOCALAPPDATA%\Uta-Pets\claude-code"
set "UTA_RUNTIME_DIR=%UTA_USER_DATA_DIR%"
set "UTA_ENDPOINT_FILE=%UTA_USER_DATA_DIR%\runtime-endpoint.json"
start "Uta Claude Code" "%~dp0..\Uta.exe"
endlocal
