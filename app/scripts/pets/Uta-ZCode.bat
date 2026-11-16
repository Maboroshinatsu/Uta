@echo off
setlocal
set "UTA_PROFILE=pet-zcode"
set "UTA_BOUND_HOST=zcode"
set "UTA_USER_DATA_DIR=%LOCALAPPDATA%\Uta-Pets\zcode"
set "UTA_RUNTIME_DIR=%UTA_USER_DATA_DIR%"
set "UTA_ENDPOINT_FILE=%UTA_USER_DATA_DIR%\runtime-endpoint.json"
start "Uta ZCode" "%~dp0..\Uta.exe"
endlocal
