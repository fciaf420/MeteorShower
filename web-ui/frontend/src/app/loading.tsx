export default function Loading() {
  return (
    <div className="min-h-screen bg-dark-bg flex items-center justify-center">
      <div className="text-center">
        <div className="relative">
          {/* Outer ring */}
          <div className="w-16 h-16 border-4 border-primary-cyan/30 border-t-primary-cyan rounded-full animate-spin" />
          
          {/* Inner ring */}
          <div className="absolute inset-2 w-8 h-8 border-2 border-success/30 border-b-success rounded-full animate-spin" 
               style={{ animationDirection: 'reverse', animationDuration: '1s' }} />
          
          {/* Center dot */}
          <div className="absolute inset-6 w-4 h-4 bg-primary-cyan rounded-full animate-pulse" />
        </div>
        
        <div className="mt-6">
          <h3 className="text-lg font-semibold text-text-primary mb-2">Loading MeteorShower</h3>
          <p className="text-sm text-text-secondary">Initializing trading dashboard...</p>
        </div>
        
        {/* Loading dots */}
        <div className="flex justify-center space-x-1 mt-4">
          <div className="w-2 h-2 bg-primary-cyan rounded-full animate-bounce" 
               style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 bg-primary-cyan rounded-full animate-bounce" 
               style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 bg-primary-cyan rounded-full animate-bounce" 
               style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  )
}