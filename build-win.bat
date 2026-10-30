@echo off
cd /d "%~dp0"
echo === Fantasy Map Studio: build Windows installer ===
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install Node.js 18 or newer from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
if not exist build\icon.ico (
  echo File build\icon.ico not found. Unpack the whole project archive, including the "build" folder.
  pause
  exit /b 1
)
echo [1/2] Installing dependencies...
call npm install
if errorlevel 1 goto fail
echo [2/2] Building installer...
call npm run dist:win
if errorlevel 1 goto fail
echo.
echo Done. The installer is in the "dist" folder.
start "" "%~dp0dist"
pause
exit /b 0
:fail
echo.
echo Build failed. Check the messages above.
pause
exit /b 1
