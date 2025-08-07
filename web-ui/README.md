# MeteorShower Web UI

Modern web interface for the MeteorShower liquidity bot, providing real-time position monitoring, interactive configuration, and comprehensive risk management controls.

## Features

- 🎯 **Real-time Position Monitoring** - Live P&L tracking and position status
- 🎛️ **Interactive Controls** - Start, stop, and emergency close with one click  
- 📊 **Visual Dashboard** - Modern DeFi-themed interface with dark mode
- 📱 **Mobile Responsive** - Full functionality on desktop, tablet, and mobile
- ⚡ **WebSocket Integration** - Sub-second updates for position changes
- 🛡️ **Risk Management** - Take profit/stop loss controls and safety features
- ⚙️ **Configuration UI** - Visual setup wizard replacing CLI prompts

## Architecture

### Backend API (`/backend`)
- Express.js server wrapping existing CLI functionality
- WebSocket server for real-time updates
- RESTful API endpoints for all bot operations
- Security middleware and rate limiting

### Frontend (`/frontend`) 
- Next.js 14 with TypeScript and App Router
- Tailwind CSS with custom DeFi design system
- Zustand for lightweight state management
- Recharts for data visualization
- Real-time WebSocket integration

## Quick Start

### Prerequisites
- Node.js 18+ 
- Existing MeteorShower bot setup with `.env` configuration
- All dependencies from main project installed

### Installation
```bash
# Install all dependencies
cd web-ui
npm run install:all

# Start both backend and frontend in development mode
npm run dev
```

The web UI will be available at:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **WebSocket**: ws://localhost:3001

### Production Build
```bash
# Build frontend for production
npm run build

# Start both servers in production mode  
npm start
```

## API Endpoints

### Position Management
- `POST /api/positions/start` - Start bot with configuration
- `POST /api/positions/stop` - Stop bot operation  
- `POST /api/positions/close` - Emergency close all positions
- `GET /api/positions/status` - Current position status and P&L

### Wallet Operations
- `GET /api/wallet/balance` - Wallet balance information
- `GET /api/wallet/address` - Wallet public key

### Configuration
- `GET /api/config` - Get current bot configuration
- `POST /api/config` - Update bot configuration
- `POST /api/config/validate` - Validate configuration
- `GET /api/config/pools` - Available pool information

### WebSocket Events
- `botStatus` - Bot start/stop events
- `position` - Position creation/updates
- `pnl` - Profit/loss changes
- `rebalance` - Rebalancing events
- `positionClosed` - Position closure events

## Components

### Core Components
- `DashboardHeader` - Navigation and connection status
- `PositionCard` - Active position display with visual range
- `PLTracker` - Real-time profit/loss tracking  
- `ControlPanel` - Bot control buttons and status

### Layout Components
- `DashboardLayout` - Main application shell
- `WebSocketProvider` - Real-time data connection

### Utilities
- `useBotStore` - Zustand store for bot state
- `useWebSocket` - WebSocket connection management
- `api.ts` - Typed API client utilities

## Environment Variables

### Backend (`.env` in project root)
```env
# Existing MeteorShower configuration
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
WALLET_PATH=path/to/your/wallet.json
POOL_ADDRESS=your_pool_address

# API server configuration (optional)
API_PORT=3001
FRONTEND_URL=http://localhost:3000
```

### Frontend (`.env.local`)
```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001
```

## Design System

### Color Palette
- **Background**: `#0B0E18` (deep navy)
- **Surface**: `#1A1F2E` (lighter navy) 
- **Primary**: `#00D4FF` (cyan)
- **Success**: `#00E676` (bright green)
- **Warning**: `#FFB300` (amber)
- **Error**: `#FF5252` (red)

### Typography
- **Font**: Inter with fallback system fonts
- **Mono**: UI monospace for addresses and technical data

### Components
Custom Tailwind CSS classes for consistent DeFi aesthetics:
- `btn-primary` - Primary action buttons with glow effects
- `btn-secondary` - Secondary buttons with hover states
- `card` - Main content containers with cyber borders
- `metric-card` - Small data display cards
- `status-dot` - Animated status indicators

## Security

- CORS protection for API endpoints
- Rate limiting to prevent API abuse
- Input validation for all configuration updates
- Secure WebSocket connections with authentication
- Environment variable protection for sensitive data

## Performance

- WebSocket connections with automatic reconnection
- Zustand for optimized state management
- Component-level re-render optimization
- Lazy loading for non-critical components
- Production build optimization with Next.js

## Mobile Support

Fully responsive design with:
- Touch-optimized button sizes (44px minimum)
- Mobile navigation menu
- Swipe gestures for data panels
- Progressive Web App capabilities
- Offline status handling

## Development

### Project Structure
```
web-ui/
├── backend/          # Express API server
│   ├── routes/       # API endpoint definitions
│   ├── server.js     # Main server file
│   └── package.json  
├── frontend/         # Next.js React app
│   ├── src/
│   │   ├── app/      # Next.js app router pages
│   │   ├── components/ # UI components
│   │   ├── hooks/    # Custom React hooks  
│   │   └── utils/    # Utilities and API client
│   └── package.json
├── shared/           # Shared TypeScript types
└── README.md
```

### Adding New Features

1. **API Endpoints**: Add new routes in `backend/routes/`
2. **UI Components**: Create in appropriate `frontend/src/components/` subdirectory
3. **State Management**: Extend `useBotStore` in `frontend/src/utils/store.ts`
4. **WebSocket Events**: Handle in `useWebSocket` hook
5. **Styling**: Use existing Tailwind classes or extend theme

### Type Safety

Full TypeScript integration with:
- Shared type definitions in `/shared/types.ts`
- API response typing in `utils/api.ts`
- Component prop validation
- Store state typing with Zustand

## Troubleshooting

### Common Issues

**WebSocket Connection Failed**
- Check if backend server is running on port 3001
- Verify firewall settings allow WebSocket connections
- Check browser developer tools for connection errors

**API Calls Failing**  
- Ensure backend server is accessible at configured URL
- Check CORS configuration in backend
- Verify environment variables are properly set

**Bot Commands Not Working**
- Confirm original CLI bot works from command line
- Check file paths in environment variables
- Verify wallet permissions and SOL balance

**UI Not Updating**
- Check WebSocket connection status in developer tools
- Verify bot is actually running and generating output
- Check browser console for JavaScript errors

### Debug Mode

Enable verbose logging:
```bash
# Backend debug mode
DEBUG=meteorshower:* npm run backend:dev

# Frontend development mode with detailed errors
npm run frontend:dev
```

## Contributing

1. Follow existing code style and TypeScript patterns
2. Add proper error handling for all API calls
3. Include responsive design for mobile devices
4. Test WebSocket reconnection scenarios
5. Update type definitions for new features

## License

This web UI is part of the MeteorShower project and follows the same license terms.