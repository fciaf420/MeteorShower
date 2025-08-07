// API utilities for communicating with the backend
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001'

export class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message)
    this.name = 'ApiError'
  }
}

const apiRequest = async <T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> => {
  const url = `${API_BASE_URL}${endpoint}`
  
  const config: RequestInit = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  }

  try {
    const response = await fetch(url, config)
    const data = await response.json()

    if (!response.ok) {
      throw new ApiError(
        data.message || `HTTP error! status: ${response.status}`,
        response.status
      )
    }

    return data
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }
    
    // Network or other errors
    throw new ApiError(
      error instanceof Error ? error.message : 'Network error occurred'
    )
  }
}

// Position API
export const positionApi = {
  getStatus: () => apiRequest('/api/positions/status'),
  
  start: (config: { interval?: number }) => 
    apiRequest('/api/positions/start', {
      method: 'POST',
      body: JSON.stringify(config),
    }),
  
  stop: () => 
    apiRequest('/api/positions/stop', {
      method: 'POST',
    }),
  
  close: () => 
    apiRequest('/api/positions/close', {
      method: 'POST',
    }),
}

// Wallet API
export const walletApi = {
  getBalance: () => apiRequest('/api/wallet/balance'),
  
  getAddress: () => apiRequest('/api/wallet/address'),
}

// Configuration API
export const configApi = {
  get: () => apiRequest('/api/config'),
  
  update: (config: Record<string, any>) =>
    apiRequest('/api/config', {
      method: 'POST',
      body: JSON.stringify(config),
    }),
  
  validate: (config: Record<string, any>) =>
    apiRequest('/api/config/validate', {
      method: 'POST',
      body: JSON.stringify({ config }),
    }),
  
  getPools: () => apiRequest('/api/config/pools'),
}