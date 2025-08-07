'use client'

import { useState, useEffect } from 'react'
import { MagnifyingGlassIcon, ChevronDownIcon } from '@heroicons/react/24/outline'
import { configApi } from '@/utils/api'

interface Pool {
  address: string
  name: string
  tokenX: string
  tokenY: string
  fee: string
  apy: string
  tvl: string
}

interface PoolSelectorProps {
  value: string
  onChange: (poolAddress: string) => void
  className?: string
}

export default function PoolSelector({ value, onChange, className = '' }: PoolSelectorProps) {
  const [pools, setPools] = useState<Pool[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadPools()
  }, [])

  const loadPools = async () => {
    try {
      setLoading(true)
      const response = await configApi.getPools()
      if (response.status === 'success') {
        setPools(response.data || [])
      }
    } catch (error) {
      console.error('Failed to load pools:', error)
      // Add some default pools
      setPools([
        {
          address: '6wJ7W3oHj7ex6MVFp2o26NSof3aey7U8Brs8E371WCXA',
          name: 'SOL/USDC',
          tokenX: 'SOL',
          tokenY: 'USDC',
          fee: '0.25%',
          apy: '12.5%',
          tvl: '$1.2M'
        },
        {
          address: '2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv',
          name: 'SOL/USDT',
          tokenX: 'SOL',
          tokenY: 'USDT',
          fee: '0.25%',
          apy: '10.8%',
          tvl: '$890K'
        },
        {
          address: 'Cs6MuBEhUznVN9JWKcnfqm4JesbhwKZ2Nh7PMj2zd1P8',
          name: 'SOL/BONK',
          tokenX: 'SOL',
          tokenY: 'BONK',
          fee: '1.0%',
          apy: '25.3%',
          tvl: '$450K'
        }
      ])
    } finally {
      setLoading(false)
    }
  }

  const selectedPool = pools.find(pool => pool.address === value)
  
  const filteredPools = pools.filter(pool =>
    pool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    pool.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
    pool.tokenX.toLowerCase().includes(searchQuery.toLowerCase()) ||
    pool.tokenY.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleSelectPool = (pool: Pool) => {
    onChange(pool.address)
    setIsOpen(false)
    setSearchQuery('')
  }

  return (
    <div className={`relative ${className}`}>
      {/* Selected Pool Display */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="input-field w-full flex items-center justify-between"
      >
        <div className="flex-1 text-left">
          {selectedPool ? (
            <div>
              <div className="font-medium text-text-primary">{selectedPool.name}</div>
              <div className="text-sm text-text-secondary">
                {selectedPool.address.slice(0, 8)}...{selectedPool.address.slice(-8)}
              </div>
            </div>
          ) : (
            <div className="text-text-muted">Select a pool...</div>
          )}
        </div>
        <ChevronDownIcon 
          className={`w-5 h-5 text-text-secondary transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`} 
        />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-dark-surface border border-primary-cyan/20 rounded-xl shadow-cyber z-50 overflow-hidden">
          {/* Search */}
          <div className="p-3 border-b border-dark-border">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                placeholder="Search pools..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-text-primary placeholder-text-muted focus:border-primary-cyan focus:outline-none"
              />
            </div>
          </div>

          {/* Pool List */}
          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center text-text-secondary">
                <div className="animate-spin w-5 h-5 border-2 border-primary-cyan border-t-transparent rounded-full mx-auto mb-2" />
                Loading pools...
              </div>
            ) : filteredPools.length === 0 ? (
              <div className="p-4 text-center text-text-secondary">
                No pools found matching your search
              </div>
            ) : (
              filteredPools.map((pool) => (
                <button
                  key={pool.address}
                  onClick={() => handleSelectPool(pool)}
                  className="w-full p-3 text-left hover:bg-dark-bg transition-colors border-b border-dark-border last:border-b-0"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-text-primary">{pool.name}</div>
                      <div className="text-sm text-text-secondary">
                        {pool.address.slice(0, 12)}...{pool.address.slice(-12)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium text-success">{pool.apy} APY</div>
                      <div className="text-xs text-text-muted">
                        {pool.tvl} • {pool.fee} fee
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Manual Entry Option */}
          <div className="p-3 border-t border-dark-border bg-dark-bg/50">
            <div className="text-xs text-text-muted mb-2">Or enter pool address manually:</div>
            <input
              type="text"
              placeholder="Pool address..."
              className="w-full px-3 py-2 bg-dark-surface border border-dark-border rounded-lg text-text-primary placeholder-text-muted focus:border-primary-cyan focus:outline-none text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const address = e.currentTarget.value.trim()
                  if (address) {
                    onChange(address)
                    setIsOpen(false)
                    e.currentTarget.value = ''
                  }
                }
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}