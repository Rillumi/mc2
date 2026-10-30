@echo off
chcp 65001 >nul
title 上传 ModPilot 版本
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
git push origin main
if errorlevel 1 goto fail
echo.
echo 已上传到 Gitee：https://gitee.com/qw-star/mc
goto end

:fail
echo.
echo 上传失败：可能是网络问题，或 Gitee 登录失效。
echo 可以先在命令行执行 git push origin main 看具体原因。

:end
pause
