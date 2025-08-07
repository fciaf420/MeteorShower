'use client'

import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-dark-bg flex items-center justify-center">
      <div className="max-w-md w-full mx-4">
        <div className="card text-center">
          <div className="text-6xl mb-4">🌌</div>
          <h2 className="text-2xl font-bold text-text-primary mb-2">Page Not Found</h2>
          <p className="text-text-secondary mb-6">
            The page you're looking for doesn't exist or has been moved.
          </p>
          <div className="space-y-3">
            <Link href="/" className="btn-primary w-full inline-block">
              Return to Dashboard
            </Link>
            <button
              onClick={() => window.history.back()}
              className="btn-secondary w-full"
            >
              Go Back
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}