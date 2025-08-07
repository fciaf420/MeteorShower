'use client'

import React, { createContext, useContext, useEffect, useRef, ReactNode } from 'react'
import { useBotStore } from '@/utils/store'

interface WebSocketContextType {
  send: (message: any) => void
  isConnected: boolean
}

const WebSocketContext = createContext<WebSocketContextType | null>(null)

export const useWebSocket = () => {
  const context = useContext(WebSocketContext)
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider')
  }
  return context
}

interface WebSocketProviderProps {
  url: string
  children: ReactNode
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({ url, children }) => {
  const ws = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>()
  const reconnectAttempts = useRef(0)
  const maxReconnectAttempts = 5
  const reconnectDelay = 3000

  const {
    setConnectionStatus,
    setBotStatus,
    setPosition,
    setPnL,
    updateRebalanceCount,
    setError
  } = useBotStore()

  const connect = () => {
    try {
      setConnectionStatus('connecting')
      ws.current = new WebSocket(url)

      ws.current.onopen = () => {
        console.log('🔌 WebSocket connected')
        setConnectionStatus('connected')
        reconnectAttempts.current = 0
        
        // Subscribe to all data streams
        send({
          type: 'subscribe',
          streams: ['position', 'pnl', 'botStatus', 'rebalance']
        })
      }

      ws.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          handleWebSocketMessage(message)
        } catch (error) {
          console.error('❌ Error parsing WebSocket message:', error)
        }
      }

      ws.current.onclose = (event) => {
        console.log('🔌 WebSocket disconnected:', event.code, event.reason)
        setConnectionStatus('disconnected')
        
        // Attempt to reconnect if it wasn't a manual close
        if (event.code !== 1000 && reconnectAttempts.current < maxReconnectAttempts) {
          scheduleReconnect()
        }
      }

      ws.current.onerror = (error) => {
        console.error('❌ WebSocket error:', error)
        setConnectionStatus('error')
        setError('WebSocket connection failed')
      }

    } catch (error) {
      console.error('❌ Error creating WebSocket connection:', error)
      setConnectionStatus('error')
      setError('Failed to establish WebSocket connection')
    }
  }

  const scheduleReconnect = () => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current)
    }
    
    reconnectAttempts.current++
    const delay = reconnectDelay * Math.pow(2, reconnectAttempts.current - 1)
    
    console.log(`🔄 Scheduling reconnect attempt ${reconnectAttempts.current} in ${delay}ms`)
    
    reconnectTimer.current = setTimeout(() => {
      connect()
    }, delay)
  }

  const send = (message: any) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message))
    } else {
      console.warn('⚠️ Cannot send message, WebSocket not connected')
    }
  }

  const handleWebSocketMessage = (message: any) => {
    const { type, data, timestamp } = message

    switch (type) {
      case 'connection':
        console.log('✅ WebSocket connection confirmed')
        break

      case 'botStatus':
        setBotStatus(data)
        break

      case 'position':
        setPosition(data)
        break

      case 'pnl':
        setPnL(data)
        break

      case 'rebalance':
        updateRebalanceCount(data.count)
        console.log('📊 Rebalance event:', data)
        break

      case 'positionClosed':
        console.log('🎯 Position closed:', data)
        // Reset position data
        setPosition(undefined)
        setPnL({ total: 0, percentage: 0, fees: 0 })
        break

      case 'error':
        setError(data.message || 'Unknown WebSocket error')
        break

      case 'pong':
        // Heartbeat response
        break

      default:
        console.log('📨 Unknown WebSocket message type:', type, data)
    }
  }

  // Heartbeat to keep connection alive
  useEffect(() => {
    const heartbeat = setInterval(() => {
      send({ type: 'ping' })
    }, 30000) // Send ping every 30 seconds

    return () => clearInterval(heartbeat)
  }, [])

  // Initialize WebSocket connection
  useEffect(() => {
    connect()

    return () => {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current)
      }
      if (ws.current) {
        ws.current.close(1000, 'Component unmounting')
      }
    }
  }, [url])

  const value: WebSocketContextType = {
    send,
    isConnected: ws.current?.readyState === WebSocket.OPEN
  }

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  )
}