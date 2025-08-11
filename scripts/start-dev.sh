#!/bin/bash

# Development startup script for n8n SaaS Platform
echo "🚀 Starting n8n SaaS Platform Development Environment"
echo "=================================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16+ first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✅ Node.js version: $(node --version)"
echo "✅ npm version: $(npm --version)"
echo ""

# Function to check if port is in use
check_port() {
    if lsof -Pi :$1 -sTCP:LISTEN -t >/dev/null; then
        echo "⚠️  Port $1 is already in use. Please stop the process or use a different port."
        return 1
    fi
    return 0
}

# Check if required ports are available
echo "🔍 Checking port availability..."
check_port 5000 || exit 1
check_port 3000 || exit 1
echo "✅ Ports 5000 and 3000 are available"
echo ""

# Start backend server in background
echo "🔧 Starting backend server on port 5000..."
cd "$(dirname "$0")/.."
npm run dev &
BACKEND_PID=$!
echo "✅ Backend server started (PID: $BACKEND_PID)"

# Wait a moment for backend to start
sleep 3

# Start frontend server
echo "🎨 Starting frontend server on port 3000..."
cd frontend
npm start &
FRONTEND_PID=$!
echo "✅ Frontend server started (PID: $FRONTEND_PID)"

echo ""
echo "🎉 Development environment is ready!"
echo "=================================================="
echo "📊 Backend API: http://localhost:5000"
echo "🌐 Frontend App: http://localhost:3000"
echo "📚 API Health: http://localhost:5000/api/health"
echo ""
echo "Press Ctrl+C to stop both servers"

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down servers..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    echo "✅ Servers stopped"
    exit 0
}

# Set trap to cleanup on script exit
trap cleanup SIGINT SIGTERM

# Wait for user to stop the script
wait
