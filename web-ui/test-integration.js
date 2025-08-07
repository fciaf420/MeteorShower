// ───────────────────────────────────────────────
// ~/web-ui/test-integration.js - Integration test script
// ───────────────────────────────────────────────
import fetch from 'node-fetch';
import WebSocket from 'ws';

const API_BASE_URL = 'http://localhost:3001';
const WS_URL = 'ws://localhost:3001';

console.log('🧪 Starting MeteorShower Web UI integration tests...\n');

// Test API Health Check
async function testHealthCheck() {
  try {
    console.log('🔍 Testing API health check...');
    const response = await fetch(`${API_BASE_URL}/health`);
    const data = await response.json();
    
    if (response.ok && data.status === 'healthy') {
      console.log('✅ Health check passed');
      return true;
    } else {
      console.log('❌ Health check failed:', data);
      return false;
    }
  } catch (error) {
    console.log('❌ Health check error:', error.message);
    return false;
  }
}

// Test Position Status API
async function testPositionStatus() {
  try {
    console.log('🔍 Testing position status API...');
    const response = await fetch(`${API_BASE_URL}/api/positions/status`);
    const data = await response.json();
    
    if (response.ok && data.status === 'success') {
      console.log('✅ Position status API working');
      console.log('📊 Bot running:', data.data.isRunning);
      return true;
    } else {
      console.log('❌ Position status failed:', data);
      return false;
    }
  } catch (error) {
    console.log('❌ Position status error:', error.message);
    return false;
  }
}

// Test WebSocket Connection
function testWebSocketConnection() {
  return new Promise((resolve) => {
    console.log('🔍 Testing WebSocket connection...');
    
    const ws = new WebSocket(WS_URL);
    let connected = false;
    
    const timeout = setTimeout(() => {
      if (!connected) {
        console.log('❌ WebSocket connection timeout');
        ws.close();
        resolve(false);
      }
    }, 5000);
    
    ws.on('open', () => {
      connected = true;
      console.log('✅ WebSocket connected successfully');
      
      // Send a test message
      ws.send(JSON.stringify({ type: 'ping' }));
    });
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('📨 Received WebSocket message:', message.type);
        
        if (message.type === 'connection') {
          console.log('✅ WebSocket connection confirmed');
          clearTimeout(timeout);
          ws.close();
          resolve(true);
        }
      } catch (error) {
        console.log('⚠️ WebSocket message parse error:', error.message);
      }
    });
    
    ws.on('error', (error) => {
      console.log('❌ WebSocket error:', error.message);
      clearTimeout(timeout);
      resolve(false);
    });
    
    ws.on('close', () => {
      console.log('🔌 WebSocket connection closed');
    });
  });
}

// Test Configuration API
async function testConfigAPI() {
  try {
    console.log('🔍 Testing configuration API...');
    const response = await fetch(`${API_BASE_URL}/api/config`);
    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Configuration API working');
      console.log('⚙️ Found config keys:', Object.keys(data.data || {}).length);
      return true;
    } else {
      console.log('❌ Configuration API failed:', data);
      return false;
    }
  } catch (error) {
    console.log('❌ Configuration API error:', error.message);
    return false;
  }
}

// Run all tests
async function runIntegrationTests() {
  console.log('Starting integration test suite...\n');
  
  const results = {
    health: await testHealthCheck(),
    position: await testPositionStatus(),
    websocket: await testWebSocketConnection(),
    config: await testConfigAPI(),
  };
  
  console.log('\n📋 Test Results:');
  console.log('================');
  
  let passed = 0;
  let total = 0;
  
  for (const [test, result] of Object.entries(results)) {
    total++;
    if (result) passed++;
    console.log(`${result ? '✅' : '❌'} ${test.charAt(0).toUpperCase() + test.slice(1)} API`);
  }
  
  console.log(`\n🎯 Overall: ${passed}/${total} tests passed`);
  
  if (passed === total) {
    console.log('🎉 All integration tests passed! Web UI is ready to use.');
    console.log('\n🚀 Start the full application with: npm run dev');
    console.log('🌐 Frontend will be available at: http://localhost:3000');
  } else {
    console.log('❌ Some tests failed. Please check the configuration and try again.');
  }
  
  process.exit(passed === total ? 0 : 1);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Test interrupted by user');
  process.exit(1);
});

// Run tests
runIntegrationTests().catch((error) => {
  console.error('❌ Test suite error:', error);
  process.exit(1);
});