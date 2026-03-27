@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File ".\prepare_github_pages.ps1"

if errorlevel 1 (
  echo.
  echo Failed to prepare docs for GitHub Pages.
  pause
  exit /b 1
)

echo.
echo GitHub Pages docs folder is ready.
pause
