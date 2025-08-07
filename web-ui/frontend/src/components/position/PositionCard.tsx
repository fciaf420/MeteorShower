'use client'

import { useBotStore, selectPosition } from '@/utils/store'
import { ChartBarIcon, ClockIcon } from '@heroicons/react/24/outline'

export default function PositionCard() {
  const position = useBotStore(selectPosition)

  const formatTimeAgo = (timestamp: string) => {
    const now = new Date()
    const then = new Date(timestamp)
    const diffMs = now.getTime() - then.getTime()
    const diffSeconds = Math.floor(diffMs / 1000)
    const diffMinutes = Math.floor(diffSeconds / 60)
    const diffHours = Math.floor(diffMinutes / 60)

    if (diffHours > 0) return `${diffHours}h ${diffMinutes % 60}m ago`
    if (diffMinutes > 0) return `${diffMinutes}m ago`
    return `${diffSeconds}s ago`
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-glow flex items-center space-x-2">
          <ChartBarIcon className="w-5 h-5" />
          <span>Active Position</span>
        </h3>
        {position && (
          <div className="flex items-center space-x-1 text-xs text-success">
            <div className="status-dot running" />
            <span>Active</span>
          </div>
        )}
      </div>

      {position ? (
        <div className="space-y-4">
          {/* Position Info */}
          <div className="text-center">
            <div className="text-text-primary font-medium mb-1">
              {position.info}
            </div>
            <div className="flex items-center justify-center space-x-1 text-sm text-text-secondary">
              <ClockIcon className="w-4 h-4" />
              <span>Updated {formatTimeAgo(position.timestamp)}</span>
            </div>
          </div>

          {/* Position Range Visualization */}
          <div className="bg-dark-surface/50 rounded-lg p-4">
            <div className="text-sm text-text-secondary mb-2 text-center">Position Range</div>
            
            {/* Visual range indicator */}
            <div className="relative h-8 bg-dark-border rounded-full overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-primary-cyan/20 via-primary-cyan/40 to-primary-cyan/20" />
              
              {/* Active price indicator */}
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                <div className="w-3 h-3 bg-success rounded-full shadow-glow" />
              </div>
            </div>

            {/* Range labels */}
            <div className="flex justify-between text-xs text-text-muted mt-2">
              <span>Lower Bound</span>
              <span>Current Price</span>
              <span>Upper Bound</span>
            </div>
          </div>

          {/* Additional Position Details */}
          {(position.poolAddress || position.lowerBinId || position.upperBinId) && (
            <div className="space-y-2">
              {position.poolAddress && (
                <div className="metric-card">
                  <div className="flex justify-between items-center">
                    <span className="text-text-secondary text-sm">Pool</span>
                    <span className="text-text-primary text-sm font-mono">
                      {`${position.poolAddress.slice(0, 6)}...${position.poolAddress.slice(-6)}`}
                    </span>
                  </div>
                </div>
              )}

              {position.lowerBinId && position.upperBinId && (
                <div className="metric-card">
                  <div className="flex justify-between items-center">
                    <span className="text-text-secondary text-sm">Bin Range</span>
                    <span className="text-text-primary text-sm font-mono">
                      {position.lowerBinId} - {position.upperBinId}
                    </span>
                  </div>
                </div>
              )}

              {position.activeBinId && (
                <div className="metric-card">
                  <div className="flex justify-between items-center">
                    <span className="text-text-secondary text-sm">Active Bin</span>
                    <span className="text-success text-sm font-mono">
                      {position.activeBinId}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto mb-4 border-2 border-dashed border-dark-border rounded-lg flex items-center justify-center">
            <ChartBarIcon className="w-8 h-8 text-text-muted" />
          </div>
          <p className="text-text-secondary">No active position</p>
          <p className="text-sm text-text-muted mt-1">Start the bot to create a position</p>
        </div>
      )}
    </div>
  )
}