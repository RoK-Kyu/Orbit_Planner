@echo off
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo Install Node.js LTS from https://nodejs.org then run this file again.
  pause
  exit /b 1
)
call npm ci
if errorlevel 1 (
  echo Dependency installation failed. Check your internet connection.
  pause
  exit /b 1
)
call npm run dist
if errorlevel 1 (
  echo Build failed. Please share the error shown above.
  pause
  exit /b 1
)
start "" "%~dp0dist"
echo Open the Orbit Planner Setup executable in the dist folder to install.
pause
