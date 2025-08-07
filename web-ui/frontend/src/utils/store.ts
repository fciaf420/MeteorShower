import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

interface BotStatus {
  isRunning: boolean
  processId?: number
  startTime?: string
  stopTime?: string
}

interface PositionInfo {
  info: string
  timestamp: string
  poolAddress?: string
  lowerBinId?: number
  upperBinId?: number
  activeBinId?: number
}

interface PnLData {
  total: number
  percentage: number
  fees: number
  initialInvestment?: number
  currentValue?: number
}

interface WalletBalance {
  totalBalance: number
  availableBalance: number
  reservedForFees: number
  address?: string
}

interface BotConfig {
  interval?: number
  poolAddress?: string
  binSpan?: number
  tokenRatio?: string
  takeProfitPercent?: number
  stopLossPercent?: number
  swaplessRebalance?: boolean
  autoCompound?: boolean
}

interface BotState {
  // Connection status
  isConnected: boolean
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error'
  lastUpdate?: string
  
  // Bot status
  botStatus: BotStatus
  
  // Position data
  position?: PositionInfo
  pnl: PnLData
  
  // Wallet data
  wallet?: WalletBalance
  
  // Configuration
  config: BotConfig
  
  // Performance metrics
  rebalanceCount: number
  performanceMetrics: {
    totalRebalances: number
    successfulRebalances: number
    failedRebalances: number
    averageRebalanceTime: number
    totalFeesEarned: number
  }
  
  // Error handling
  lastError?: string
  
  // Actions
  setConnectionStatus: (status: BotState['connectionStatus']) => void
  setBotStatus: (status: BotStatus) => void
  setPosition: (position: PositionInfo) => void
  setPnL: (pnl: PnLData) => void
  setWallet: (wallet: WalletBalance) => void
  setConfig: (config: Partial<BotConfig>) => void
  updateRebalanceCount: (count: number) => void
  setError: (error?: string) => void
  reset: () => void
}

const initialState = {
  isConnected: false,
  connectionStatus: 'disconnected' as const,
  botStatus: { isRunning: false },
  pnl: { total: 0, percentage: 0, fees: 0 },
  config: { interval: 5 },
  rebalanceCount: 0,
  performanceMetrics: {
    totalRebalances: 0,
    successfulRebalances: 0,
    failedRebalances: 0,
    averageRebalanceTime: 0,
    totalFeesEarned: 0,
  },
}

export const useBotStore = create<BotState>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,
    
    setConnectionStatus: (status) => 
      set({ 
        connectionStatus: status, 
        isConnected: status === 'connected',
        lastUpdate: new Date().toISOString()
      }),
    
    setBotStatus: (status) => 
      set({ 
        botStatus: status,
        lastUpdate: new Date().toISOString()
      }),
    
    setPosition: (position) => 
      set({ 
        position,
        lastUpdate: new Date().toISOString()
      }),
    
    setPnL: (pnl) => 
      set({ 
        pnl,
        lastUpdate: new Date().toISOString()
      }),
    
    setWallet: (wallet) => 
      set({ 
        wallet,
        lastUpdate: new Date().toISOString()
      }),
    
    setConfig: (config) => 
      set((state) => ({ 
        config: { ...state.config, ...config },
        lastUpdate: new Date().toISOString()
      })),
    
    updateRebalanceCount: (count) => 
      set((state) => ({
        rebalanceCount: count,
        performanceMetrics: {
          ...state.performanceMetrics,
          totalRebalances: count,
        },
        lastUpdate: new Date().toISOString()
      })),
    
    setError: (error) => 
      set({ 
        lastError: error,
        lastUpdate: new Date().toISOString()
      }),
    
    reset: () => set(initialState),
  }))
)

// Selectors for optimized re-renders
export const selectBotStatus = (state: BotState) => state.botStatus
export const selectPosition = (state: BotState) => state.position
export const selectPnL = (state: BotState) => state.pnl
export const selectWallet = (state: BotState) => state.wallet
export const selectConfig = (state: BotState) => state.config
export const selectConnectionStatus = (state: BotState) => state.connectionStatus