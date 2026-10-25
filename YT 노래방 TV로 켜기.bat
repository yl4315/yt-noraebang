@echo off
rem YT noraebang (TV): start the local server and open the TV screen in Chrome, full screen.
rem If the server is already running, only the TV screen opens.
rem Close this window to stop the server.
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python is not installed. Please install it from https://www.python.org
  pause
  exit /b
)
python server.py 5173 --lan --tv
if errorlevel 1 pause
