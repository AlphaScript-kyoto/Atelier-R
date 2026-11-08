@echo off
chcp 65001 > nul
cd /d "%~dp0ComfyUI"

echo.
echo  ノード編集画面を起動します。
echo  ブラウザで http://127.0.0.1:8188 を開いてください。
echo  普段は start_comfyui.bat の Atelier R を使ってください。
echo.

if not exist ".venv\Scripts\python.exe" (
    echo Python の仮想環境が見つかりません。README.md の「最初の準備」を見てください。
    pause
    exit /b 1
)

".venv\Scripts\python.exe" main.py --listen 127.0.0.1 --port 8188
echo.
pause
