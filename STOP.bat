@echo off
rem Double-click to stop Smart Truck.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\stop-demo.ps1"
pause
