@echo off
setlocal

REM Double-click to export .docx -> .jsxdata (shows file dialogs)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\export_docx_styles.ps1"

endlocal
