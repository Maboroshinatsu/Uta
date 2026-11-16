@echo off
setlocal
set "UTA_PROFILE=pet-harness"
set "UTA_BOUND_HOST=harness"
set "UTA_USER_DATA_DIR=%LOCALAPPDATA%\Uta-Pets\harness"
set "UTA_RUNTIME_DIR=%UTA_USER_DATA_DIR%"
set "UTA_ENDPOINT_FILE=%UTA_USER_DATA_DIR%\runtime-endpoint.json"
start "Uta DeepSeek Harness" "%~dp0..\Uta.exe"
endlocal
