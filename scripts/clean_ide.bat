
@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

REM Check parameters
if "%~1"=="" (
    echo Error: Please specify the editor to clean
    echo.
    echo Usage: %0 ^<editor_name^>
    echo Supported editors: vscode, vscode-insiders, cursor, trae, qoder
    pause
    exit /b
)

set "editor=%~1"
set "YourUsername="
for %%a in ("%userprofile%") do set "YourUsername=%%~nxa"

echo Getting system username: %YourUsername%
echo Specified editor: %editor%
echo.

REM Set editor-specific paths
if /i "%editor%"=="vscode" (
    set "configDir=.vscode"
    set "dataDir=Code"
) else if /i "%editor%"=="vscode-insiders" (
    set "configDir=.vscode-insiders"
    set "dataDir=Code - Insiders"
) else if /i "%editor%"=="vscode-insider" (
    set "configDir=.vscode-insiders"
    set "dataDir=Code - Insiders"
) else if /i "%editor%"=="cursor" (
    set "configDir=.cursor"
    set "dataDir=Cursor"
) else if /i "%editor%"=="trae" (
    set "configDir=.trae"
    set "dataDir=Trae"
) else if /i "%editor%"=="qoder" (
    set "configDir=.qoder"
    set "dataDir=Qoder"
) else (
    echo Unsupported editor: %editor%
    echo Supported editors: vscode, vscode-insiders, cursor, trae, qoder
    pause
    exit /b
)

REM Clean configuration directory
set "configPath=%userprofile%\%configDir%"
if exist "%configPath%" (
    echo Checking %configDir% folder...
    echo Detected %configDir% folder, starting cleanup...
    rmdir /s /q "%configPath%"
    echo %configDir% folder has been cleaned.
) else (
    echo %configDir% folder not found. Skipping cleanup...
)

echo.

REM Clean data directory
set "dataPath=%userprofile%\AppData\Roaming\%dataDir%"
if exist "%dataPath%" (
    echo Checking %dataDir% folder...
    echo Detected %dataDir% folder, starting cleanup...
    rmdir /s /q "%dataPath%"
    echo %dataDir% folder has been cleaned.
) else (
    echo %dataDir% folder not found. Skipping cleanup...
)

echo.
echo Cleanup completed.
echo By Wuhan Excellence Technology Co., Ltd.
pause
