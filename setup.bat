@echo off
title Delivery Order OCR - Setup

echo ========================================
echo   Delivery Order OCR - Environment Setup
echo ========================================
echo.

python --version >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python not found. Please install Python 3.10+
    echo         https://www.python.org/downloads/
    pause
    exit /b 1
)

echo [1/2] Creating virtual environment venv ...
if exist venv (
    echo        venv already exists, skipping.
) else (
    python -m venv venv
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to create venv!
        pause
        exit /b 1
    )
    echo        Done!
)

echo.
echo [2/2] Installing dependencies (using Tsinghua mirror) ...
call venv\Scripts\activate.bat
pip install -r backend\requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple --trusted-host pypi.tuna.tsinghua.edu.cn
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies!
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Setup complete! Run start.bat to launch
echo ========================================
echo.
pause
