// ───────────────────────────────────────────────
// ~/web-ui/shared/types.ts - Shared TypeScript interfaces
// ───────────────────────────────────────────────

export interface ApiResponse<T = any> {
  status: 'success' | 'error';
  message?: string;
  data?: T;
  errors?: string[];
  timestamp?: string;
}

export interface BotStatus {
  isRunning: boolean;
  processId?: number;
  startTime?: string;
  stopTime?: string;
  exitCode?: number;
}

export interface PositionInfo {
  info: string;
  timestamp: string;
  poolAddress?: string;
  lowerBinId?: number;
  upperBinId?: number;
  activeBinId?: number;
}

export interface PnLData {
  total: number;
  percentage: number;
  fees: number;
  initialInvestment?: number;
  currentValue?: number;
}

export interface WalletBalance {
  totalBalance: number;
  availableBalance: number;
  reservedForFees: number;
  address?: string;
  tokens: TokenBalance[];
}

export interface TokenBalance {
  symbol: string;
  balance: number;
  usdValue?: number;
}

export interface BotConfig {
  RPC_URL?: string;
  WALLET_PATH?: string;
  POOL_ADDRESS?: string;
  TOTAL_BINS_SPAN?: number;
  TOKEN_RATIO?: string;
  LIQUIDITY_STRATEGY?: string;
  SWAPLESS_REBALANCE?: boolean;
  SWAPLESS_BIN_SPAN?: number;
  AUTO_COMPOUND?: boolean;
  TAKE_PROFIT_PERCENT?: number;
  STOP_LOSS_PERCENT?: number;
  CENTER_DISTANCE_THRESHOLD?: number;
  PRIORITY_FEE_MICRO_LAMPORTS?: number;
  SLIPPAGE?: number;
  MONITOR_INTERVAL_SECONDS?: number;
  LOG_LEVEL?: string;
}

export interface PoolInfo {
  address: string;
  name: string;
  tokenX: string;
  tokenY: string;
  fee: string;
  apy: string;
  tvl: string;
  activeBin?: number;
  currentPrice?: number;
}

export interface WebSocketMessage {
  type: string;
  data?: any;
  timestamp: number;
}

export interface RebalanceEvent {
  count: number;
  timestamp: string;
  info: string;
  previousRange?: {
    lowerBinId: number;
    upperBinId: number;
  };
  newRange?: {
    lowerBinId: number;
    upperBinId: number;
  };
}

export interface RiskSettings {
  takeProfitEnabled: boolean;
  takeProfitPercent: number;
  stopLossEnabled: boolean;
  stopLossPercent: number;
  emergencyStopEnabled: boolean;
  maxDailyLoss?: number;
}

export interface AllocationStrategy {
  name: string;
  description: string;
  solRatio: number;
  tokenRatio: number;
  binSpan: number;
  liquidityStrategy: 'Spot' | 'Curve' | 'BidAsk';
  swaplessRebalance: boolean;
  autoCompound: boolean;
}

export interface PerformanceMetrics {
  totalRebalances: number;
  averageRebalanceTime: number;
  successfulRebalances: number;
  failedRebalances: number;
  totalFeesEarned: number;
  roi24h: number;
  roi7d: number;
  roi30d: number;
  sharpeRatio?: number;
  maxDrawdown?: number;
}

// WebSocket event types
export type WSEventType = 
  | 'connection'
  | 'botStatus'
  | 'position'
  | 'pnl'
  | 'rebalance'
  | 'positionClosed'
  | 'error'
  | 'ping'
  | 'pong';

// API endpoint types
export interface StartBotRequest {
  interval?: number;
  config?: Partial<BotConfig>;
}

export interface UpdateConfigRequest {
  [key: string]: string | number | boolean;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}