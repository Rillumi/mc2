@echo off
chcp 65001 >nul
title 上传 ModPilot 到 Gitee
cd /d "%~dp0"
node "%~dp0scripts\publish.cjs" --remotes origin --interactive
set "PUBLISH_EXIT=%ERRORLEVEL%"
pause
exit /b %PUBLISH_EXIT%
