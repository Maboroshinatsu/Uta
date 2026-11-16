@echo off
setlocal

rem Self-locating launcher: the server file is resolved relative to this script,
rem so it works regardless of the host's working directory.
set "HERE=%~dp0"
set "SERVER=%HERE%..\server.mjs"

if not exist "%SERVER%" (
  echo deskpet-mcp: server.mjs not found next to launcher 1>&2
  exit /b 66
)

rem Reuse the Node runtime that ships with Codex when available.
if defined CODEX_MCP_NODE_PATH if exist "%CODEX_MCP_NODE_PATH%" (
  "%CODEX_MCP_NODE_PATH%" "%SERVER%"
  exit /b %ERRORLEVEL%
)
if defined CODEX_BROWSER_USE_NODE_PATH if exist "%CODEX_BROWSER_USE_NODE_PATH%" (
  "%CODEX_BROWSER_USE_NODE_PATH%" "%SERVER%"
  exit /b %ERRORLEVEL%
)
if defined CODEX_ELECTRON_RESOURCES_PATH if exist "%CODEX_ELECTRON_RESOURCES_PATH%\cua_node\bin\node.exe" (
  "%CODEX_ELECTRON_RESOURCES_PATH%\cua_node\bin\node.exe" "%SERVER%"
  exit /b %ERRORLEVEL%
)
if defined CODEX_CLI_PATH for %%I in ("%CODEX_CLI_PATH%") do if exist "%%~dpIcua_node\bin\node.exe" (
  "%%~dpIcua_node\bin\node.exe" "%SERVER%"
  exit /b %ERRORLEVEL%
)
if defined LOCALAPPDATA for /d %%D in ("%LOCALAPPDATA%\[OI]\Codex\runtimes\cua_node\*") do if exist "%%~fD\bin\node.exe" (
  "%%~fD\bin\node.exe" "%SERVER%"
  exit /b %ERRORLEVEL%
)

where node >nul 2>&1
if not errorlevel 1 (
  node "%SERVER%"
  exit /b %ERRORLEVEL%
)

echo deskpet-mcp: could not find a Node runtime. Install Node.js or update Codex. 1>&2
exit /b 127
