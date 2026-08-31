@echo off
setlocal
cd /d "%~dp0\..\.."
if not exist "logs" mkdir "logs"
node scripts\track3r-local-bridge\agent.js sync >> logs\track3r-local-bridge.log 2>&1
exit /b %errorlevel%
