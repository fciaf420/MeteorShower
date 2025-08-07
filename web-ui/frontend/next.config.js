/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:3001',
    WS_URL: process.env.WS_URL || 'ws://localhost:3001',
  },
  webpack: (config) => {
    // Handle WebSocket in browser
    config.resolve.fallback = {
      ...config.resolve.fallback,
      net: false,
      tls: false,
      fs: false,
    };
    return config;
  },
}

module.exports = nextConfig