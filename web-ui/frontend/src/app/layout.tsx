import './globals.css'
import { Inter } from 'next/font/google'
import { Metadata } from 'next'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'MeteorShower - Liquidity Bot Dashboard',
  description: 'Advanced liquidity bot for Meteora DLMM pools on Solana',
  viewport: 'width=device-width, initial-scale=1',
  themeColor: '#00D4FF',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} antialiased`}>
        <div className="min-h-screen bg-dark-bg">
          {children}
        </div>
      </body>
    </html>
  )
}