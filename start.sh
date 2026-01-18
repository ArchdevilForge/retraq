#!/bin/bash
set -e

cd "$(dirname "$0")"

# Start backend
echo "🚀 Starting backend..."
cd backend
uv sync

# Import sample data
echo "📥 Importing sample data..."
uv run python import_data.py

uv run uvicorn main:app --reload --port 9527 &
BACKEND_PID=$!
cd ..

# Start frontend
echo "🎨 Building frontend..."
cd frontend
pnpm install
pnpm build
echo "🌐 Starting frontend preview..."
pnpm preview --port 9528 &
FRONTEND_PID=$!
cd ..

echo ""
echo "✅ Services started:"
echo "   Backend:  http://localhost:9527"
echo "   Frontend: http://localhost:9528"
echo ""
echo "Press Ctrl+C to stop all services"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
wait
