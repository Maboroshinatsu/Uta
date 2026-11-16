@echo off
setlocal

rem Self-locating launcher for Antigravity MCP Server
set "HERE=%~dp0"
set "SERVER="

if exist "%HERE%..\runtime\deskpet-mcp.mjs" set "SERVER=%HERE%..\runtime\deskpet-mcp.mjs"
if not defined SERVER if exist "%HERE%..\..\deskpet-mcp\server.mjs" set "SERVER=%HERE%..\..\deskpet-mcp\server.mjs"
if not defined SERVER if exist "%HERE%..\deskpet-mcp.mjs" set "SERVER=%HERE%..\deskpet-mcp.mjs"

if not defined SERVER (
  echo [uta-deskpet-mcp] server file not found. 1>&2
  exit /b 66
)

where node >nul 2>&1
if not errorlevel 1 (
  node "%SERVER%"
  exit /b %ERRORLEVEL%
)

echo [uta-deskpet-mcp] node.exe runtime not found in PATH. 1>&2
exit /b 127
