@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

title word-to-photoshop CEP full reinstall

echo.
echo ============================================================
echo   CEP full reinstall only (ASCII-safe .cmd)
echo   Repo: %CD%
echo   This will kill PS-related processes, uninstall, install, then try to start PS.
echo ============================================================
echo.
pause

echo.
echo ==========================================
echo [1/4] Stop Photoshop / CEP related processes
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
echo [OK] kill step done
echo.

echo ==========================================
echo [2/4] Uninstall CEP
echo ==========================================
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\uninstall_cep.ps1" -NoPause
if errorlevel 1 (
  echo [ERR] uninstall failed
  pause
  exit /b 1
)
echo [OK] uninstall done
echo.

echo ==========================================
echo [3/4] Install CEP
echo ==========================================
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\install_cep.ps1" -NoPause
if errorlevel 1 (
  echo [ERR] install failed
  pause
  exit /b 1
)

echo.
echo ==========================================
echo [4/4] Try start Photoshop
echo ==========================================
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='SilentlyContinue';" ^
  "$exe=$null;" ^
  "try { $cmd=Get-Command 'Photoshop.exe' -ErrorAction SilentlyContinue; if($cmd -and $cmd.Source){ $exe=$cmd.Source } } catch {}" ^
  "if(-not $exe){" ^
  "  $keys=@(" ^
  "    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Photoshop.exe'," ^
  "    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\Photoshop.exe'," ^
  "    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Photoshop.exe'," ^
  "    'HKCU:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\Photoshop.exe'" ^
  "  );" ^
  "  foreach($k in $keys){" ^
  "    try { if(Test-Path $k){ $v=(Get-Item $k).GetValue(''); if($v -and (Test-Path $v)){ $exe=$v; break } } } catch {}" ^
  "  }" ^
  "}" ^
  "if($exe){" ^
  "  try { Start-Process -FilePath $exe | Out-Null; Write-Host ('[OK] Photoshop: ' + $exe) } catch { Write-Host ('[WARN] launch: ' + $_.Exception.Message) }" ^
  "} else {" ^
  "  Write-Host '[WARN] Photoshop.exe not found.';" ^
  "}"

echo.
echo [OK] full reinstall done
pause
exit /b 0
