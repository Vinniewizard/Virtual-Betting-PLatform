#!/bin/bash
# Quick Start Script for Betting Server

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo "🎮 Betting Server - Quick Start"
echo "================================="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 22+"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
    echo "⚠️  Node.js 22+ required (you have: $(node -v))"
fi

echo "✅ Node.js $(node -v) detected"
echo ""

# Step 1: Install dependencies
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install --silent
    echo "✅ Dependencies installed"
    echo ""
else
    echo "✅ Dependencies already installed"
    echo ""
fi

# Step 2: Build
echo "🔨 Building TypeScript..."
npm run build --silent
echo "✅ Build complete"
echo ""

# Step 3: Check for .env
if [ ! -f ".env" ]; then
    echo "📝 Creating .env file..."
    cat > .env << 'EOF'
PORT=3001
JWT_SECRET=dev-secret-change-in-production
DB_FILE=betting.db
MAX_BODY_SIZE_BYTES=102400
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=admin123
SEED_ADMIN_BALANCE=10000
EOF
    echo "✅ .env created (edit for production)"
    echo ""
fi

# Step 4: Kill existing processes on port 3001
if lsof -i :3001 >/dev/null 2>&1; then
    echo "🛑 Stopping existing process on port 3001..."
    lsof -i :3001 | grep -v COMMAND | awk '{print $2}' | xargs kill -9 2>/dev/null || true
    sleep 1
    echo "✅ Old process killed"
    echo ""
fi

# Step 5: Start server
echo "🚀 Starting server..."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

node dist/index.js &
SERVER_PID=$!

sleep 2

# Step 6: Verify server is running
if curl -s http://localhost:3001/health > /dev/null 2>&1; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "✅ Server is running!"
    echo ""
    echo "📱 Open in browser:"
    echo "   http://localhost:3001/test-client.html"
    echo ""
    echo "🔐 Test Credentials:"
    echo "   Username: admin"
    echo "   Password: admin123"
    echo ""
    echo "📚 Documentation:"
    echo "   - SETUP_GUIDE.md (detailed setup)"
    echo "   - IMPROVEMENTS.md (recommendations)"
    echo "   - README.md (quick reference)"
    echo ""
    echo "💡 Useful Commands:"
    echo "   npm run dev    (development with hot reload)"
    echo "   npm test       (integration tests)"
    echo "   npm run smoke  (quick health check)"
    echo ""
    echo "🛑 To stop the server, press Ctrl+C"
    echo ""
    
    # Keep the process running
    wait $SERVER_PID
else
    echo "❌ Server failed to start"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi
