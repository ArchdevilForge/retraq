@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo 🚀 Starting backend...
cd backend
call uv sync

echo 📥 Importing sample data...
call uv run python import_data.py

start "Backend" cmd /c "uv run uvicorn main:app --reload --port 9527"
cd ..

echo 🎨 Building frontend...
cd frontend
call pnpm install
call pnpm build
echo 🌐 Starting frontend preview...
start "Frontend" cmd /c "pnpm preview --port 9528"
cd ..

echo.
echo ✅ Services started:
echo    Backend:  http://localhost:9527
echo    Frontend: http://localhost:9528
echo.
echo Press any key to stop all services...
pause >nul

taskkill /FI "WINDOWTITLE eq Backend*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Frontend*" /F >nul 2>&1
