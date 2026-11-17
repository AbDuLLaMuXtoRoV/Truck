@echo off
rem Double-click to start Smart Truck (API + Telegram bot + AI + dashboard).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\start-demo.ps1"
if exist "%~dp0deploy\pids.json" start "" http://localhost:3000
echo.
echo If something failed, see the messages above and the files in deploy\logs\
pause
