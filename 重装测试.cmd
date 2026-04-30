@echo off
setlocal
cd /d "%~dp0"
call ".\reinstall_test.cmd"
exit /b %errorlevel%
