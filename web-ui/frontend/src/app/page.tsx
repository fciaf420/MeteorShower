'use client'

import { useEffect, useState } from 'react'
import DashboardHeader from '@/components/layout/DashboardHeader'
import PositionCard from '@/components/position/PositionCard'
import ControlPanel from '@/components/controls/ControlPanel'
import PLTracker from '@/components/position/PLTracker'
import { WebSocketProvider } from '@/hooks/useWebSocket'
import { useBotStore } from '@/utils/store'

export default function Dashboard() {
  const [mounted, setMounted] = useState(false)
  
  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div className="min-h-screen bg-dark-bg flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-primary-cyan border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <WebSocketProvider url={process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001'}>
      <div className="min-h-screen bg-dark-bg">
        <DashboardHeader />
        
        <main className="container mx-auto px-4 py-8 max-w-7xl">
          {/* Top metrics row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <PLTracker />
            <PositionCard />
            <ControlPanel />
          </div>
          
          {/* Additional content sections can go here */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Position chart will go here */}
            <div className="card">
              <h3 className="text-xl font-semibold mb-4 text-glow">Position Range</h3>
              <div className="h-64 flex items-center justify-center text-text-secondary">
                <div className="text-center">
                  <div className="w-16 h-16 mx-auto mb-4 border-2 border-dashed border-dark-border rounded-lg flex items-center justify-center">
                    📊
                  </div>
                  <p>Price chart will be displayed here</p>
                  <p className="text-sm text-text-muted mt-2">Connect your bot to see position data</p>
                </div>
              </div>
            </div>
            
            {/* Performance metrics */}
            <div className="card">
              <h3 className="text-xl font-semibold mb-4 text-glow">Performance Metrics</h3>
              <div className="space-y-4">
                <div className="metric-card">
                  <div className="flex justify-between items-center">
                    <span className="text-text-secondary">Total Rebalances</span>
                    <span className="text-text-primary font-semibold">0</span>
                  </div>
                </div>
                <div className="metric-card">
                  <div className="flex justify-between items-center">
                    <span className="text-text-secondary">Success Rate</span>
                    <span className="text-success font-semibold">--</span>
                  </div>
                </div>
                <div className="metric-card">
                  <div className="flex justify-between items-center">
                    <span className="text-text-secondary">Avg. Fee Capture</span>
                    <span className="text-text-primary font-semibold">--</span>
                  </div>
                </div>
                <div className="metric-card">
                  <div className="flex justify-between items-center">
                    <span className="text-text-secondary">Uptime</span>
                    <span className="text-text-primary font-semibold">--</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </WebSocketProvider>
  )
}