@echo off
setlocal
chcp 65001 >nul
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
cd /d "%~dp0"

echo [1/3] 检查 Rust...
cargo --version || goto :missing

echo [2/3] 下载并安装项目依赖...
call pnpm install --frozen-lockfile || goto :failed

echo [3/3] 生成 Windows 安装包（可能需要较长时间）...
call pnpm tauri build || goto :failed

echo.
echo 编译完成。
echo 安装包位置：
echo %CD%\src-tauri\target\release\bundle\nsis
explorer "%CD%\src-tauri\target\release\bundle\nsis"
pause
exit /b 0

:missing
echo.
echo 未找到 Rust。请关闭此窗口，重启电脑后再双击本文件。
pause
exit /b 1

:failed
echo.
echo 构建失败。请不要关闭窗口，截取最后的错误内容发给 Codex。
pause
exit /b 1
