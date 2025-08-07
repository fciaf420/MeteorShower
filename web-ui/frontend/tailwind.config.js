/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // DeFi dark theme colors
        'dark': {
          'bg': '#0B0E18',
          'surface': '#1A1F2E',
          'surface-light': '#252B3A',
          'border': '#2D3748',
        },
        'primary': {
          'cyan': '#00D4FF',
          'cyan-dark': '#0099CC',
          'cyan-light': '#33E0FF',
        },
        'success': '#00E676',
        'warning': '#FFB300',
        'error': '#FF5252',
        'text': {
          'primary': '#FFFFFF',
          'secondary': '#B0BEC5',
          'muted': '#78909C',
        }
      },
      backgroundImage: {
        'gradient-dark': 'linear-gradient(135deg, #1A1F2E 0%, #2D3748 100%)',
        'gradient-primary': 'linear-gradient(135deg, #00D4FF 0%, #0099CC 100%)',
        'gradient-surface': 'linear-gradient(135deg, #252B3A 0%, #1A1F2E 100%)',
      },
      boxShadow: {
        'glow': '0 0 8px currentColor',
        'glow-lg': '0 0 16px currentColor',
        'cyber': '0 8px 32px rgba(0, 212, 255, 0.1)',
        'cyber-lg': '0 8px 32px rgba(0, 212, 255, 0.3)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'slide-up': 'slideUp 0.3s ease-out',
        'fade-in': 'fadeIn 0.3s ease-out',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 8px rgba(0, 212, 255, 0.5)' },
          '100%': { boxShadow: '0 0 24px rgba(0, 212, 255, 0.8)' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      fontFamily: {
        'mono': ['ui-monospace', 'SFMono-Regular', 'Monaco', 'Consolas', 'monospace'],
      },
      backdropBlur: {
        xs: '2px',
      }
    },
  },
  plugins: [],
}