@echo off
title Backup Manager - Installation
color 0A

echo ========================================
echo   Backup Manager - Installation Script
echo ========================================
echo.

echo [1/3] Installing dependencies...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: npm install failed
    pause
    exit /b 1
)

echo.
echo [2/3] Dependencies installed successfully!
echo.

echo [3/3] Starting application...
call npm start

pause
