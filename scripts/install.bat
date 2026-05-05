@echo off
REM Cutpilot - Windows install script

setlocal EnableDelayedExpansion

set EXTENSION_ID=com.cutpilot.app
set CEP_DIR=%APPDATA%\Adobe\CEP\extensions
set INSTALL_DIR=%CEP_DIR%\%EXTENSION_ID%
set OLD_TALKY_DIR=%CEP_DIR%\com.talky.captioner
set SCRIPT_DIR=%~dp0
set SOURCE_DIR=%SCRIPT_DIR%..

echo.
echo  ==============================================
echo       Cutpilot - Premiere Pro Installer
echo  ==============================================
echo.

REM 1. Remove old installs
if exist "%OLD_TALKY_DIR%" (
    echo  ^> Removing old Talky installation...
    rmdir /s /q "%OLD_TALKY_DIR%"
)
if exist "%INSTALL_DIR%" (
    echo  ^> Removing previous Cutpilot installation...
    rmdir /s /q "%INSTALL_DIR%"
)

REM 2. Prepare CEP folder
echo  ^> Preparing CEP extensions folder...
if not exist "%CEP_DIR%" mkdir "%CEP_DIR%"
mkdir "%INSTALL_DIR%"

REM 3. Copy plugin files
echo  ^> Copying Cutpilot files...
xcopy /e /i /q "%SOURCE_DIR%\CSXS"   "%INSTALL_DIR%\CSXS\"
xcopy /e /i /q "%SOURCE_DIR%\client" "%INSTALL_DIR%\client\"
xcopy /e /i /q "%SOURCE_DIR%\host"   "%INSTALL_DIR%\host\"

if exist "%SOURCE_DIR%\.debug" (
    copy "%SOURCE_DIR%\.debug" "%INSTALL_DIR%\.debug"
)

echo     OK Files copied to: %INSTALL_DIR%

REM 4. Enable CEP debug mode
echo  ^> Enabling CEP debug mode...
for %%v in (9 10 11 12) do (
    reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
    echo     OK CSXS.%%v PlayerDebugMode = 1
)

REM 5. FFmpeg check
echo.
echo  ^> Checking for FFmpeg...
where ffmpeg >nul 2>&1
if %errorlevel% == 0 (
    echo     OK FFmpeg is installed.
) else (
    echo.
    echo     ! FFmpeg not found.
    echo.
    echo     Install options:
    echo     1. winget install ffmpeg
    echo     2. choco install ffmpeg
    echo     3. https://www.gyan.dev/ffmpeg/builds/  (manual)
    echo.
)

REM 6. Done
echo.
echo  ==============================================
echo            INSTALLATION COMPLETE
echo  ==============================================
echo.
echo  Next steps:
echo    1. Quit and reopen Premiere Pro
echo    2. Window ^> Extensions ^> Cutpilot
echo    3. Click the gear icon, paste your OpenAI API key
echo       (get one from platform.openai.com/api-keys)
echo.
echo  Debug: Chrome ^> http://localhost:7777
echo.
pause
