'use client'

import { useState } from 'react'
import { useBotStore } from '@/utils/store'
import { useWebSocket } from '@/hooks/useWebSocket'
import ConfigurationModal from '@/components/config/ConfigurationModal'

export default function DashboardHeader() {
  const { connectionStatus, wallet } = useBotStore()
  const { isConnected } = useWebSocket()
  const [showConfigModal, setShowConfigModal] = useState(false)

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'text-success'
      case 'connecting':
        return 'text-warning'
      case 'disconnected':
      case 'error':
      default:
        return 'text-error'
    }
  }

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'Connected'
      case 'connecting':
        return 'Connecting...'
      case 'disconnected':
        return 'Disconnected'
      case 'error':
        return 'Connection Error'
      default:
        return 'Unknown'
    }
  }

  return (
    <header className="bg-gradient-dark border-b border-primary-cyan/20 backdrop-blur-sm">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          {/* Logo and Title */}
          <div className="flex items-center space-x-3">
            <div className="text-2xl">🌠</div>
            <div>
              <h1 className="text-2xl font-bold text-glow">MeteorShower</h1>
              <p className="text-sm text-text-secondary">Liquidity Bot Dashboard</p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="hidden md:flex space-x-8">
            <button className="nav-tab active">
              Portfolio
            </button>
            <button className="nav-tab">
              Positions
            </button>
            <button 
              onClick={() => setShowConfigModal(true)}
              className="nav-tab"
            >
              Settings
            </button>
          </nav>

          {/* Status and Wallet Info */}
          <div className="flex items-center space-x-4">
            {/* Connection Status */}
            <div className="flex items-center space-x-2">
              <div className={`status-dot ${isConnected ? 'running' : 'stopped'}`} />
              <span className={`text-sm ${getConnectionStatusColor()}`}>
                {getConnectionStatusText()}
              </span>
            </div>

            {/* Wallet Balance */}
            {wallet && (
              <div className="hidden sm:flex items-center space-x-3 bg-dark-surface/50 rounded-lg px-3 py-2 border border-dark-border">
                <div className="text-sm">
                  <div className="text-text-secondary">Balance</div>
                  <div className="font-semibold text-text-primary">
                    {wallet.availableBalance.toFixed(4)} SOL
                  </div>
                </div>
              </div>
            )}

            {/* User Profile */}
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-gradient-primary rounded-full flex items-center justify-center">
                <span className="text-white text-sm font-semibold">U</span>
              </div>
              <div className="hidden sm:block text-sm">
                <div className="text-text-primary font-medium">User</div>
                <div className="text-text-muted text-xs">
                  {wallet?.address ? 
                    `${wallet.address.slice(0, 4)}...${wallet.address.slice(-4)}` : 
                    'Not connected'
                  }
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Navigation */}
      <div className="md:hidden border-t border-dark-border">
        <div className="container mx-auto px-4 py-2">
          <div className="flex space-x-4 overflow-x-auto scrollbar-thin">
            <button className="nav-tab active whitespace-nowrap">
              Portfolio
            </button>
            <button className="nav-tab whitespace-nowrap">
              Positions
            </button>
            <button 
              onClick={() => setShowConfigModal(true)}
              className="nav-tab whitespace-nowrap"
            >
              Settings
            </button>
          </div>
        </div>
      </div>

      {/* Configuration Modal */}
      <ConfigurationModal 
        isOpen={showConfigModal}
        onClose={() => setShowConfigModal(false)}
      />
    </header>
  )
}