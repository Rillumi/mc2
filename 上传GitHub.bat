@echo off
chcp 65001 >nul
title 上传 ModPilot 到 GitHub
cd /d "%~dp0"

git add -A
git diff --cached --quiet
if errorlevel 1 goto commit
echo 没有改动，不需要上传。
goto end

:commit
set "MSG="
set /p "MSG=这次改了什么（直接回车用日期）："
if not defined MSG set "MSG=版本 %date% %time%"
git commit -m "%MSG%"
if errorlevel 1 goto fail
git push github main
if errorlevel 1 goto fail
echo.
echo 已上传到 GitHub：https://github.com/Rillumi/mc2
goto end

:fail
echo.
echo 上传失败：可能是网络问题，或 GitHub 登录失效。
echo 可以先在命令行执行 git push github main 看具体原因。

:end
pause
