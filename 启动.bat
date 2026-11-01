@echo off
chcp 65001 >nul 2>nul
title ModPilot
cd /d "%~dp0"

where node >nul 2>nul
if not errorlevel 1 (
  echo 正在启动 ModPilot，稍后会自动打开默认浏览器...
  echo 默认地址：http://127.0.0.1:8737/index.html（端口被占会自动往后换，以窗口里显示的为准）
  node server.js
  if errorlevel 1 (
    echo.
    echo 服务异常退出，把上面的报错发给我看看。
    pause
  )
  goto :end
)

where python >nul 2>nul
if not errorlevel 1 (
  echo 正在启动本地服务...
  start "" /b python -m http.server 8737 --bind 127.0.0.1
  timeout /t 1 /nobreak >nul
  start "" "http://127.0.0.1:8737/index.html"
  echo.
  echo ModPilot 已启动：http://127.0.0.1:8737/index.html
  echo 关闭这个窗口就会停止服务。
  pause
  goto :end
)

echo 没有找到 Node 或 Python，直接用浏览器打开本地文件。
echo 如果浏览器提示打不开，请安装 Node.js 后再运行这个启动器。
start "" "index.html"

:end
