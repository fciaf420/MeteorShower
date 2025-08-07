'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Application error:', error)
  }, [error])

  return (
    <div className="min-h-screen bg-dark-bg flex items-center justify-center">
      <div className="max-w-md w-full mx-4">
        <div className="card text-center">
          <div className="text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-error mb-4">Something went wrong</h2>
          <p className="text-text-secondary mb-6">
            An error occurred while loading the application. This might be a temporary issue.
          </p>
          <div className="space-y-3">
            <button
              onClick={reset}
              className="btn-primary w-full"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="btn-secondary w-full"
            >
              Reload page
            </button>
          </div>
          {process.env.NODE_ENV === 'development' && (
            <details className="mt-4 text-left">
              <summary className="text-sm text-text-muted cursor-pointer">
                Error details (development only)
              </summary>
              <pre className="text-xs text-error mt-2 p-2 bg-error/10 rounded overflow-auto">
                {error.message}
                {error.stack && `\n${error.stack}`}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}