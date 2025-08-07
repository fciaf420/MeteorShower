'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html>
      <body className="bg-dark-bg text-text-primary">
        <div className="min-h-screen flex items-center justify-center">
          <div className="max-w-md w-full mx-4">
            <div className="bg-gradient-surface border border-error/30 rounded-2xl p-8 text-center shadow-cyber">
              <div className="text-6xl mb-4">🚨</div>
              <h2 className="text-2xl font-bold text-error mb-4">Critical Error</h2>
              <p className="text-text-secondary mb-6">
                A critical error occurred in the application. Please try refreshing the page.
              </p>
              <div className="space-y-3">
                <button
                  onClick={reset}
                  className="w-full bg-error hover:bg-error/80 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200"
                >
                  Try again
                </button>
                <button
                  onClick={() => window.location.href = '/'}
                  className="w-full bg-dark-surface hover:bg-dark-surface-light text-text-primary font-semibold py-3 px-6 rounded-xl border border-dark-border transition-all duration-200"
                >
                  Go to homepage
                </button>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  )
}