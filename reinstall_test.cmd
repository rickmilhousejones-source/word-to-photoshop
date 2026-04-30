@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo [1/3] Kill Photoshop related processes
echo ==========================================
for %%P in (
  "Photoshop.exe"
  "CEPHtmlEngine.exe"
  "CEPHtmlEngineHelper.exe"
  "Adobe CEF Helper.exe"
  "CRLogTransport2.exe"
  "CCLibrary.exe"
  "CCXProcess.exe"
  "CoreSync.exe"
) do (
  taskkill /F /IM "%%~P" >nul 2>&1
)
echo [OK] Kill step done
echo.

echo ==========================================
echo [2/3] Uninstall CEP
echo ==========================================
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\uninstall_cep.ps1" -NoPause
if errorlevel 1 (
  echo [ERR] Uninstall failed
  echo.
  pause
  exit /b 1
)
echo [OK] Uninstall done
echo.

echo ==========================================
echo [3/3] Install CEP
echo ==========================================
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\install_cep.ps1" -NoPause
if errorlevel 1 (
  echo [ERR] Install failed
  echo.
  pause
  exit /b 1
)

echo.
echo [OK] Reinstall completed
pause
exit /b 0
