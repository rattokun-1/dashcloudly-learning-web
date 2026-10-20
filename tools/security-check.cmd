@echo off
setlocal
cd /d "%~dp0.."
where node >nul 2>&1
if not errorlevel 1 (
  node "%~dp0security-check.mjs"
) else if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
  "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" "%~dp0security-check.mjs"
) else (
  echo Node.js 22 or newer is required. Install it from https://nodejs.org/
  pause
  exit /b 2
)
set "check_result=%errorlevel%"
echo.
echo Check finished. Exit code: %check_result%
echo The JSON report is in the security-reports folder.
pause
exit /b %check_result%
