@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo [ERROR] node not found in PATH & pause & exit /b 1)
node "%~dp0scripts\kernel-restore.mjs" %*
echo.
pause
