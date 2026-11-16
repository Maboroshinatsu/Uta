@echo off
setlocal
set "UTA_CANDIDATE_ID="
set "UTA_BOUND_HOST="
set "DESKPET_ENDPOINT_FILE="
set "UTA_CANDIDATE_DIR=%~dp0"
for /f %%I in ('powershell.exe -NoProfile -NonInteractive -Command "$p=[IO.Path]::GetFullPath($env:UTA_CANDIDATE_DIR).ToLowerInvariant(); $h=[Security.Cryptography.SHA256]::Create(); [BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($p)),0,8).Replace([string][char]45,[string]::Empty).ToLowerInvariant()"') do set "UTA_CANDIDATE_ID=%%I"
if not defined UTA_CANDIDATE_ID exit /b 1
set "UTA_PROFILE=candidate-%UTA_CANDIDATE_ID%"
set "UTA_USER_DATA_DIR=%LOCALAPPDATA%\Uta-Candidates\%UTA_CANDIDATE_ID%"
set "UTA_RUNTIME_DIR=%UTA_USER_DATA_DIR%"
set "UTA_ENDPOINT_FILE=%UTA_USER_DATA_DIR%\runtime-endpoint.json"
start "Uta candidate" "%~dp0Uta.exe"
endlocal
