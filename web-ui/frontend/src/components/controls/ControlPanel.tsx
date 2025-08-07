'use client'

import { useState } from 'react'
import { useBotStore, selectBotStatus, selectConfig } from '@/utils/store'
import { PlayIcon, StopIcon, XMarkIcon, CogIcon } from '@heroicons/react/24/outline'
import ConfigurationModal from '@/components/config/ConfigurationModal'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001'

export default function ControlPanel() {
  const botStatus = useBotStore(selectBotStatus)
  const config = useBotStore(selectConfig)
  const [loading, setLoading] = useState<'start' | 'stop' | 'close' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showConfigModal, setShowConfigModal] = useState(false)

  const handleStartBot = async () => {
    try {
      setLoading('start')
      setError(null)

      const response = await fetch(`${API_BASE_URL}/api/positions/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          interval: config.interval || 5,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || 'Failed to start bot')
      }

      console.log('✅ Bot started successfully:', data)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
      setError(errorMessage)
      console.error('❌ Error starting bot:', err)
    } finally {
      setLoading(null)
    }
  }

  const handleStopBot = async () => {
    try {
      setLoading('stop')
      setError(null)

      const response = await fetch(`${API_BASE_URL}/api/positions/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || 'Failed to stop bot')
      }

      console.log('✅ Bot stopped successfully:', data)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
      setError(errorMessage)
      console.error('❌ Error stopping bot:', err)
    } finally {
      setLoading(null)
    }
  }

  const handleEmergencyClose = async () => {
    if (!confirm('Are you sure you want to close all positions? This action cannot be undone.')) {
      return
    }

    try {
      setLoading('close')
      setError(null)

      const response = await fetch(`${API_BASE_URL}/api/positions/close`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || 'Failed to close positions')
      }

      console.log('✅ Positions closed successfully:', data)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
      setError(errorMessage)
      console.error('❌ Error closing positions:', err)
    } finally {
      setLoading(null)
    }
  }

  const getBotStatusColor = () => {
    if (botStatus.isRunning) return 'text-success'
    return 'text-text-secondary'
  }

  const getBotStatusText = () => {
    if (botStatus.isRunning) return 'Running'
    return 'Stopped'
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-glow flex items-center space-x-2">
          <CogIcon className="w-5 h-5" />
          <span>Bot Control</span>
        </h3>
      </div>

      <div className="space-y-4">
        {/* Bot Status */}
        <div className="bg-dark-surface/50 rounded-lg p-4 text-center">
          <div className="flex items-center justify-center space-x-2 mb-2">
            <div className={`status-dot ${botStatus.isRunning ? 'running' : 'stopped'}`} />
            <span className={`font-semibold ${getBotStatusColor()}`}>
              {getBotStatusText()}
            </span>
          </div>
          
          {botStatus.processId && (
            <div className="text-xs text-text-muted">
              Process ID: {botStatus.processId}
            </div>
          )}

          {botStatus.startTime && (
            <div className="text-xs text-text-muted">
              Started: {new Date(botStatus.startTime).toLocaleTimeString()}
            </div>
          )}
        </div>

        {/* Control Buttons */}
        <div className="space-y-3">
          {!botStatus.isRunning ? (
            <button
              onClick={handleStartBot}
              disabled={loading === 'start'}
              className="btn-primary w-full flex items-center justify-center space-x-2"
            >
              {loading === 'start' ? (
                <>
                  <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                  <span>Starting...</span>
                </>
              ) : (
                <>
                  <PlayIcon className="w-4 h-4" />
                  <span>Start Bot</span>
                </>
              )}
            </button>
          ) : (
            <button
              onClick={handleStopBot}
              disabled={loading === 'stop'}
              className="btn-secondary w-full flex items-center justify-center space-x-2 border-warning text-warning hover:bg-warning/10"
            >
              {loading === 'stop' ? (
                <>
                  <div className="animate-spin w-4 h-4 border-2 border-warning border-t-transparent rounded-full" />
                  <span>Stopping...</span>
                </>
              ) : (
                <>
                  <StopIcon className="w-4 h-4" />
                  <span>Stop Bot</span>
                </>
              )}
            </button>
          )}

          {/* Emergency Close */}
          <button
            onClick={handleEmergencyClose}
            disabled={loading === 'close'}
            className="btn-secondary w-full flex items-center justify-center space-x-2 border-error text-error hover:bg-error/10"
          >
            {loading === 'close' ? (
              <>
                <div className="animate-spin w-4 h-4 border-2 border-error border-t-transparent rounded-full" />
                <span>Closing...</span>
              </>
            ) : (
              <>
                <XMarkIcon className="w-4 h-4" />
                <span>Emergency Close</span>
              </>
            )}
          </button>
        </div>

        {/* Configuration */}
        <div className="metric-card">
          <div className="flex justify-between items-center">
            <span className="text-text-secondary text-sm">Monitor Interval</span>
            <span className="text-text-primary text-sm">
              {config.interval || 5}s
            </span>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-error/10 border border-error/30 rounded-lg p-3">
            <div className="text-error text-sm">{error}</div>
          </div>
        )}

        {/* Settings Button */}
        <button 
          onClick={() => setShowConfigModal(true)}
          className="btn-secondary w-full text-sm flex items-center justify-center space-x-2"
        >
          <CogIcon className="w-4 h-4" />
          <span>Configure Settings</span>
        </button>
      </div>

      {/* Configuration Modal */}
      <ConfigurationModal 
        isOpen={showConfigModal}
        onClose={() => setShowConfigModal(false)}
      />
    </div>
  )
}