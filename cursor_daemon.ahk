#NoTrayIcon
#SingleInstance Force
#Persistent
SetBatchLines, -1
CoordMode, Mouse, Screen

outFile := A_Temp . "\word_import_cursor.json"
if (0 >= 1)
{
  outFile = %1%
}

SetTimer, Tick, 20
return

Tick:
  MouseGetPos, mx, my, hwnd
  if (hwnd = "")
    return

  WinGetPos, wx, wy, ww, wh, ahk_id %hwnd%
  if (ww = "")
    return

  winL := wx
  winT := wy
  winR := wx + ww
  winB := wy + wh

  ; AHK v1 does not provide a simple DPI-safe client rect API by default.
  ; Use window rect as fallback for client rect fields.
  clientL := winL
  clientT := winT
  clientR := winR
  clientB := winB

  ts := A_NowUTC
  EnvSub, ts, 19700101000000, Seconds
  tsMs := ts * 1000

  json := "{""ts"":" . tsMs
    . ",""cursorX"":" . mx
    . ",""cursorY"":" . my
    . ",""winL"":" . winL
    . ",""winT"":" . winT
    . ",""winR"":" . winR
    . ",""winB"":" . winB
    . ",""clientL"":" . clientL
    . ",""clientT"":" . clientT
    . ",""clientR"":" . clientR
    . ",""clientB"":" . clientB
    . "}"

  FileDelete, %outFile%
  FileAppend, %json%, %outFile%, UTF-8
return
