@echo on
setlocal
set "PATH=C:\Users\27947\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback;%USERPROFILE%\.cargo\bin;%PATH%"
set "PNPM=C:\Users\27947\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"
cd /d "%~dp0"

echo Build started. Please keep this window open.
cargo --version
if errorlevel 1 goto missing_rust

call "%PNPM%" install --frozen-lockfile
if errorlevel 1 goto build_failed

call "%PNPM%" tauri build
if errorlevel 1 goto build_failed

echo.
echo BUILD COMPLETED
echo Installer folder: %CD%\src-tauri\target\release\bundle\nsis
explorer "%CD%\src-tauri\target\release\bundle\nsis"
goto finished

:missing_rust
echo.
echo Rust was not found. Restart Windows and run this file again.
goto finished

:build_failed
echo.
echo BUILD FAILED. Take a screenshot of the last error and send it to Codex.
goto finished

:finished
echo.
echo This window will stay open.
pause
