import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'AI Native WMS',
  description: 'Smart Warehouse Management System',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <nav className="sticky top-0 z-50 w-full backdrop-blur-[20px] bg-white/70 dark:bg-black/70 border-b border-gray-200 dark:border-gray-800">
          <div className="max-w-[1200px] mx-auto px-6 h-14 flex items-center justify-between">
            <a href="/" className="font-bold text-lg tracking-tight text-textMain dark:text-white flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-primary text-white flex items-center justify-center text-xs font-black">W</span>
              AI Native WMS
            </a>
            <div className="flex items-center gap-5 text-sm font-semibold text-textMuted">
              <a href="/delivery" className="hover:text-primary transition-colors">배송 관리</a>
              <a href="/" className="hover:text-primary transition-colors">재고 현황</a>
              <a href="/report" className="hover:text-primary transition-colors">AI 리포트</a>
              <a href="/monitor" className="hover:text-red-500 transition-colors flex items-center gap-1.5 text-red-500 font-bold">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                실시간 모니터링
              </a>
            </div>
          </div>
        </nav>
        <main className="max-w-[1200px] mx-auto px-6 py-[100px]">
          {children}
        </main>
      </body>
    </html>
  )
}
