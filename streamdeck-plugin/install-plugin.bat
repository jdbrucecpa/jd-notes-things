@echo off
echo JD Notes Stream Deck Plugin Installer
echo ======================================
echo.

set PLUGIN_NAME=com.jdnotes.recording.sdPlugin
set PLUGIN_DIR=%APPDATA%\Elgato\StreamDeck\Plugins

echo Checking for Stream Deck installation...
if not exist "%PLUGIN_DIR%" (
    echo ERROR: Stream Deck plugins folder not found.
    echo Please install Stream Deck software first.
    echo Expected path: %PLUGIN_DIR%
    pause
    exit /b 1
)

echo Stream Deck plugins folder found: %PLUGIN_DIR%
echo.

REM Stop Stream Deck if running
echo Stopping Stream Deck...
taskkill /IM "StreamDeck.exe" /F >nul 2>&1
timeout /t 2 >nul

REM Remove old plugin if exists
if exist "%PLUGIN_DIR%\%PLUGIN_NAME%" (
    echo Removing old version...
    rmdir /s /q "%PLUGIN_DIR%\%PLUGIN_NAME%"
)

REM Copy new plugin
echo Installing plugin...
xcopy /s /e /i "%~dp0%PLUGIN_NAME%" "%PLUGIN_DIR%\%PLUGIN_NAME%" >nul
if errorlevel 1 (
    echo ERROR: Failed to copy plugin files.
    pause
    exit /b 1
)

echo.
echo Plugin installed successfully!
echo.
echo Starting Stream Deck...
start "" "%ProgramFiles%\Elgato\StreamDeck\StreamDeck.exe"

echo.
echo ======================================
echo Installation complete!
echo.
echo The plugin "JD Notes Recording" should now appear
echo in Stream Deck under the "JD Notes" category.
echo.
echo Make sure JD Notes is running with Stream Deck
echo integration enabled in Settings > Stream Deck.
echo ======================================
echo.
pause
