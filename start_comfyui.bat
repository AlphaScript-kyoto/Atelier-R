@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo.
echo  Atelier R を開きます。
echo  終了するときは、この画面で Ctrl+C を押してください。
echo.

if not exist "ComfyUI\.venv\Scripts\python.exe" (
    echo Python の仮想環境が見つかりません。README.md の「最初の準備」を見てください。
    pause
    exit /b 1
)

set PYTHONUNBUFFERED=1
"ComfyUI\.venv\Scripts\python.exe" studio\app.py
if errorlevel 2 (
    echo.
    echo  Atelier R はすでに開いています。
    echo  ブラウザで http://127.0.0.1:8189 を開きました。
    echo.
    pause
    exit /b 0
)
echo.
echo 終了しました。何かキーを押すとこの画面を閉じます。
pause
