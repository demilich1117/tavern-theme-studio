@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Read the whole block before uninstall removes this packaged entry point.
(
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-launcher.ps1" -Mode uninstall
pause
exit /b
)
