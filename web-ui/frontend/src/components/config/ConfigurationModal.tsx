'use client'

import { useState, useEffect } from 'react'
import { XMarkIcon, CheckIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { useBotStore } from '@/utils/store'
import { configApi } from '@/utils/api'
import PoolSelector from './PoolSelector'

interface ConfigurationModalProps {
  isOpen: boolean
  onClose: () => void
}

interface ConfigForm {
  RPC_URL: string
  WALLET_PATH: string
  POOL_ADDRESS: string
  TOTAL_BINS_SPAN: string
  LOWER_COEF: string
  LIQUIDITY_STRATEGY_TYPE: string
  PRIORITY_FEE_MICRO_LAMPORTS: string
  SOL_FEE_BUFFER_LAMPORTS: string
  PRICE_IMPACT: string
  SLIPPAGE: string
  MONITOR_INTERVAL_SECONDS: string
  MANUAL: string
  LOG_LEVEL: string
}

const defaultConfig: ConfigForm = {
  RPC_URL: 'https://mainnet.helius-rpc.com/?api-key=YOUR-API-KEY',
  WALLET_PATH: '',
  POOL_ADDRESS: '6wJ7W3oHj7ex6MVFp2o26NSof3aey7U8Brs8E371WCXA',
  TOTAL_BINS_SPAN: '40',
  LOWER_COEF: '0.5',
  LIQUIDITY_STRATEGY_TYPE: 'Spot',
  PRIORITY_FEE_MICRO_LAMPORTS: '50000',
  SOL_FEE_BUFFER_LAMPORTS: '70000000',
  PRICE_IMPACT: '0.1',
  SLIPPAGE: '10',
  MONITOR_INTERVAL_SECONDS: '30',
  MANUAL: 'true',
  LOG_LEVEL: 'info'
}

export default function ConfigurationModal({ isOpen, onClose }: ConfigurationModalProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [config, setConfig] = useState<ConfigForm>(defaultConfig)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})

  const steps = [
    {
      title: 'Network Configuration',
      description: 'Configure your Solana RPC connection',
      fields: ['RPC_URL']
    },
    {
      title: 'Wallet Setup',
      description: 'Set up your wallet and keys',
      fields: ['WALLET_PATH']
    },
    {
      title: 'Pool Configuration',
      description: 'Configure the liquidity pool settings',
      fields: ['POOL_ADDRESS', 'TOTAL_BINS_SPAN', 'LOWER_COEF', 'LIQUIDITY_STRATEGY_TYPE']
    },
    {
      title: 'Trading Parameters',
      description: 'Configure fees and trading settings',
      fields: ['PRIORITY_FEE_MICRO_LAMPORTS', 'SOL_FEE_BUFFER_LAMPORTS', 'PRICE_IMPACT', 'SLIPPAGE']
    },
    {
      title: 'System Settings',
      description: 'Configure monitoring and logging',
      fields: ['MONITOR_INTERVAL_SECONDS', 'MANUAL', 'LOG_LEVEL']
    }
  ]

  // Load existing configuration
  useEffect(() => {
    if (isOpen) {
      loadCurrentConfig()
    }
  }, [isOpen])

  const loadCurrentConfig = async () => {
    try {
      setLoading(true)
      const response = await configApi.get()
      console.log('Configuration API response:', response)
      
      if (response.status === 'success' && response.data) {
        // Convert any existing config values to strings for form compatibility
        const formConfig = Object.keys(response.data).reduce((acc, key) => {
          // Only include keys that exist in our ConfigForm interface
          if (key in defaultConfig) {
            acc[key as keyof ConfigForm] = String(response.data[key] || '')
          }
          return acc
        }, {} as ConfigForm)
        
        console.log('Processed form config:', formConfig)
        setConfig(prev => ({ ...prev, ...formConfig }))
      } else {
        console.log('No config data received, using defaults')
        setConfig(defaultConfig)
      }
    } catch (error) {
      console.error('Failed to load configuration:', error)
      // If loading fails, just use defaults
      setConfig(defaultConfig)
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (field: keyof ConfigForm, value: string) => {
    setConfig(prev => ({ ...prev, [field]: value }))
    
    // Clear validation error for this field
    if (validationErrors[field]) {
      setValidationErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors[field]
        return newErrors
      })
    }
  }

  const validateStep = (stepIndex: number) => {
    const step = steps[stepIndex]
    const errors: Record<string, string> = {}

    step.fields.forEach(field => {
      const value = config[field as keyof ConfigForm]
      
      switch (field) {
        case 'RPC_URL':
          if (!value || !value.startsWith('https://')) {
            errors[field] = 'RPC URL must be a valid HTTPS endpoint'
          }
          break
        case 'WALLET_PATH':
          if (!value || !value.trim()) {
            errors[field] = 'Wallet path is required'
          }
          break
        case 'POOL_ADDRESS':
          if (!value || value.length < 32) {
            errors[field] = 'Pool address must be a valid Solana address'
          }
          break
        case 'TOTAL_BINS_SPAN':
          const binSpan = parseInt(value)
          if (!value || isNaN(binSpan) || binSpan < 1 || binSpan > 100) {
            errors[field] = 'Bin span must be between 1 and 100'
          }
          break
        case 'LOWER_COEF':
          const coef = parseFloat(value)
          if (!value || isNaN(coef) || coef < 0 || coef > 1) {
            errors[field] = 'Lower coefficient must be between 0 and 1'
          }
          break
      }
    })

    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleNext = () => {
    if (validateStep(currentStep)) {
      if (currentStep < steps.length - 1) {
        setCurrentStep(currentStep + 1)
      } else {
        handleSave()
      }
    }
  }

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleSave = async () => {
    try {
      setLoading(true)
      setError(null)

      // Validate all steps
      let allValid = true
      for (let i = 0; i < steps.length; i++) {
        if (!validateStep(i)) {
          allValid = false
          setCurrentStep(i)
          break
        }
      }

      if (!allValid) {
        setLoading(false)
        return
      }

      // Save configuration
      await configApi.update(config)
      
      // Close modal and show success
      onClose()
      // Could add a toast notification here
      
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to save configuration')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  const currentStepData = steps[currentStep]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-surface border border-primary-cyan/20 rounded-2xl shadow-cyber max-w-2xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-dark-border">
          <div>
            <h2 className="text-2xl font-bold text-glow">Bot Configuration</h2>
            <p className="text-text-secondary">Step {currentStep + 1} of {steps.length}: {currentStepData.title}</p>
          </div>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-error transition-colors"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Progress Bar */}
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-text-secondary">{currentStepData.title}</span>
            <span className="text-sm text-text-muted">{Math.round(((currentStep + 1) / steps.length) * 100)}%</span>
          </div>
          <div className="progress-bar">
            <div 
              className="progress-fill"
              style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-96">
          <div className="mb-6">
            <p className="text-text-secondary">{currentStepData.description}</p>
            {process.env.NODE_ENV === 'development' && (
              <div className="mt-2 text-xs text-text-muted">
                Debug: Step {currentStep}, Loading: {loading.toString()}
              </div>
            )}
          </div>

          {error && (
            <div className="mb-4 p-3 bg-error/10 border border-error/30 rounded-lg flex items-center space-x-2">
              <ExclamationTriangleIcon className="w-5 h-5 text-error" />
              <span className="text-error text-sm">{error}</span>
            </div>
          )}

          <div className="space-y-4">
            {currentStepData.fields.map((field) => (
              <div key={field}>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  {field.replace(/_/g, ' ')}
                  {field === 'RPC_URL' && <span className="text-error">*</span>}
                  {field === 'WALLET_PATH' && <span className="text-error">*</span>}
                  {field === 'POOL_ADDRESS' && <span className="text-error">*</span>}
                </label>
                
                {field === 'POOL_ADDRESS' ? (
                  <PoolSelector
                    value={config[field as keyof ConfigForm]}
                    onChange={(address) => handleInputChange(field as keyof ConfigForm, address)}
                    className="w-full"
                  />
                ) : field === 'LIQUIDITY_STRATEGY_TYPE' ? (
                  <select
                    value={config[field as keyof ConfigForm]}
                    onChange={(e) => handleInputChange(field as keyof ConfigForm, e.target.value)}
                    className="input-field w-full"
                  >
                    <option value="Spot">Spot</option>
                    <option value="Curve">Curve</option>
                    <option value="BidAsk">BidAsk</option>
                  </select>
                ) : field === 'LOG_LEVEL' ? (
                  <select
                    value={config[field as keyof ConfigForm]}
                    onChange={(e) => handleInputChange(field as keyof ConfigForm, e.target.value)}
                    className="input-field w-full"
                  >
                    <option value="fatal">Fatal</option>
                    <option value="error">Error</option>
                    <option value="warn">Warn</option>
                    <option value="info">Info</option>
                    <option value="debug">Debug</option>
                    <option value="trace">Trace</option>
                  </select>
                ) : field === 'MANUAL' ? (
                  <select
                    value={config[field as keyof ConfigForm]}
                    onChange={(e) => handleInputChange(field as keyof ConfigForm, e.target.value)}
                    className="input-field w-full"
                  >
                    <option value="true">True</option>
                    <option value="false">False</option>
                  </select>
                ) : (
                  <input
                    type="text"
                    value={config[field as keyof ConfigForm]}
                    onChange={(e) => handleInputChange(field as keyof ConfigForm, e.target.value)}
                    placeholder={
                      field === 'WALLET_PATH' ? 'e.g., /path/to/your/wallet.json' :
                      field === 'RPC_URL' ? 'https://mainnet.helius-rpc.com/?api-key=YOUR-KEY' :
                      field === 'POOL_ADDRESS' ? 'Solana pool address' :
                      ''
                    }
                    className="input-field w-full"
                  />
                )}
                
                {validationErrors[field] && (
                  <p className="text-error text-sm mt-1">{validationErrors[field]}</p>
                )}
                
                {/* Help text */}
                {field === 'RPC_URL' && (
                  <p className="text-text-muted text-xs mt-1">Full HTTPS endpoint for a Solana RPC node (Helius, Triton, QuickNode)</p>
                )}
                {field === 'TOTAL_BINS_SPAN' && (
                  <p className="text-text-muted text-xs mt-1">How wide the position is (total number of bins across both sides)</p>
                )}
                {field === 'LOWER_COEF' && (
                  <p className="text-text-muted text-xs mt-1">Portion of bins allocated below the active price (0-1)</p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-dark-border">
          <button
            onClick={handlePrevious}
            disabled={currentStep === 0}
            className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          
          <div className="flex space-x-2">
            {steps.map((_, index) => (
              <div
                key={index}
                className={`w-2 h-2 rounded-full ${
                  index <= currentStep ? 'bg-primary-cyan' : 'bg-dark-border'
                }`}
              />
            ))}
          </div>

          <button
            onClick={handleNext}
            disabled={loading}
            className="btn-primary flex items-center space-x-2"
          >
            {loading ? (
              <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
            ) : (
              <>
                {currentStep === steps.length - 1 ? (
                  <CheckIcon className="w-4 h-4" />
                ) : null}
                <span>{currentStep === steps.length - 1 ? 'Save Configuration' : 'Next'}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}