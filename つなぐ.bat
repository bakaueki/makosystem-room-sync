@echo off
rem makoSystem room sync launcher (Windows). Runs scripts\win\room-sync.ps1.
rem
rem This file is ASCII only, on purpose. A UTF-8 .bat that runs "chcp 65001"
rem makes cmd.exe lose track of line breaks and try to run fragments of the
rem Japanese comments as commands. All Japanese output lives in the .ps1.
rem
rem -ExecutionPolicy Bypass is a command line switch, so it does not change any
rem setting on this PC. No administrator rights are needed.
setlocal
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=powershell"
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\win\room-sync.ps1"
rem 0 = finished, 9 = the script already showed the error and waited for a key.
rem Anything else means PowerShell itself could not start (9009 = not found),
rem so hold the window open instead of letting it vanish.
if "%errorlevel%"=="0" goto :eof
if "%errorlevel%"=="9" goto :eof
rem -1073741510 = stopped with Ctrl+C. room-sync.ps1 already waited for a key.
if "%errorlevel%"=="-1073741510" goto :eof
pause
