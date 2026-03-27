@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File ".\build_plugin_snapshots.ps1"

echo.
echo ?????????...
pause >nul
