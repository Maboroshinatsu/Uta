@echo off
title Uta Desktop Companion
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-stable.ps1"
if errorlevel 1 pause
