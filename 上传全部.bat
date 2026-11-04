@echo off
chcp 65001 >nul
title 同步 ModPilot 到 Gitee 和 GitHub
cd /d "%~dp0"
node "%~dp0scripts\publish.cjs" --remotes origin,github --interactive
set "PUBLISH_EXIT=%ERRORLEVEL%"
pause
exit /b %PUBLISH_EXIT%
