@echo off
chcp 65001 > nul
cd /d "%~dp0"

rem 毎晩22時のタスクから使います。すでに開いているときは、画面を出さずに終わります。

if not exist "ComfyUI\.venv\Scripts\python.exe" (
    echo Python の仮想環境が見つかりません。README.md の「最初の準備」を見てください。
    exit /b 1
)

set STUDIO_SKIP_DIALOG=1
set PYTHONUNBUFFERED=1
"ComfyUI\.venv\Scripts\python.exe" studio\app.py
if errorlevel 2 exit /b 0
