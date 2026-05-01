@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo [1/4] Kill Photoshop related processes
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
echo [2/4] Uninstall CEP
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
echo [3/4] Install CEP
echo ==========================================
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\install_cep.ps1" -NoPause
if errorlevel 1 (
  echo [ERR] Install failed
  echo.
  pause
  exit /b 1
)

echo.
echo ==========================================
echo [4/4] Launch Photoshop
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
  "  try { Start-Process -FilePath $exe | Out-Null; Write-Host ('[OK] Photoshop launched: ' + $exe) } catch { Write-Host ('[WARN] Failed to launch Photoshop: ' + $_.Exception.Message) }" ^
  "} else {" ^
  "  Write-Host '[WARN] Photoshop.exe not found via PATH or registry App Paths.';" ^
  "}"

echo.
echo [OK] Reinstall completed
pause
exit /b 0
