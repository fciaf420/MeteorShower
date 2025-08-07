'use client'

import { useBotStore, selectPnL } from '@/utils/store'
import { ArrowTrendingUpIcon, ArrowTrendingDownIcon } from '@heroicons/react/24/outline'

export default function PLTracker() {
  const pnl = useBotStore(selectPnL)

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  }

  const formatPercentage = (percentage: number) => {
    const sign = percentage >= 0 ? '+' : ''
    return `${sign}${percentage.toFixed(2)}%`
  }

  const getPnLColor = (value: number) => {
    if (value > 0) return 'text-success'
    if (value < 0) return 'text-error'
    return 'text-text-secondary'
  }

  const getPnLIcon = (value: number) => {
    if (value > 0) return <ArrowTrendingUpIcon className="w-5 h-5" />
    if (value < 0) return <ArrowTrendingDownIcon className="w-5 h-5" />
    return null
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-glow">Portfolio P&L</h3>
        <div className="text-xs text-text-muted">Live</div>
      </div>

      <div className="space-y-4">
        {/* Total P&L */}
        <div className="text-center">
          <div className={`text-3xl font-bold ${getPnLColor(pnl.total)} flex items-center justify-center space-x-2`}>
            {getPnLIcon(pnl.total)}
            <span>{formatCurrency(pnl.total)}</span>
          </div>
          <div className={`text-lg ${getPnLColor(pnl.percentage)} flex items-center justify-center space-x-1 mt-1`}>
            <span>{formatPercentage(pnl.percentage)}</span>
          </div>
        </div>

        {/* Breakdown */}
        <div className="grid grid-cols-1 gap-3">
          {/* Current Value */}
          <div className="metric-card">
            <div className="flex justify-between items-center">
              <span className="text-text-secondary text-sm">Current Value</span>
              <span className="text-text-primary font-semibold">
                {pnl.currentValue ? formatCurrency(pnl.currentValue) : '--'}
              </span>
            </div>
          </div>

          {/* Initial Investment */}
          <div className="metric-card">
            <div className="flex justify-between items-center">
              <span className="text-text-secondary text-sm">Initial Investment</span>
              <span className="text-text-primary font-semibold">
                {pnl.initialInvestment ? formatCurrency(pnl.initialInvestment) : '--'}
              </span>
            </div>
          </div>

          {/* Fees Earned */}
          <div className="metric-card">
            <div className="flex justify-between items-center">
              <span className="text-text-secondary text-sm">Fees Earned</span>
              <span className="text-success font-semibold">
                {formatCurrency(pnl.fees)}
              </span>
            </div>
          </div>
        </div>

        {/* Performance Indicator */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-text-muted mb-1">
            <span>Performance</span>
            <span>{pnl.percentage >= 0 ? 'Profitable' : 'Loss'}</span>
          </div>
          <div className="progress-bar">
            <div 
              className={`progress-fill ${pnl.percentage >= 0 ? 'bg-success' : 'bg-error'}`}
              style={{ 
                width: `${Math.min(Math.abs(pnl.percentage) * 2, 100)}%` 
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}