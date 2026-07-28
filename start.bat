@echo off
title Delivery Order OCR System

echo ========================================
echo   Delivery Order OCR System - Starting...
echo ========================================
echo.

if not exist venv\Scripts\activate.bat (
    echo [ERROR] venv not found. Please run setup.bat first.
    pause
    exit /b 1
)

echo [0/2] Activating venv...
call venv\Scripts\activate.bat

echo.
echo [1/2] Starting backend API...
start "BackendAPI" cmd /k "cd /d %~dp0backend && python app.py --debug"

echo        Waiting for backend (8s)...
timeout /t 8 /nobreak >nul

echo.
echo [2/2] Starting frontend...
start "Frontend" cmd /k "cd /d %~dp0frontend && python -m http.server 8080"

timeout /t 2 /nobreak >nul

echo.
echo ========================================
echo   All services started!
echo   Backend API : http://localhost:5000
echo   Frontend    : http://localhost:8080/index.html
echo ========================================
echo.

start "" "http://localhost:8080/index.html" 2>nul || explorer "http://localhost:8080/index.html"
echo.
pause
