import type { Metadata } from 'next'
import './globals.css'
import { AuthProvider } from '../context/AuthContext'
import Navbar from '../components/Navbar'
import AuthGuard from '../components/AuthGuard'

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
    <html lang="ko">
      <body className="font-sans antialiased bg-gray-50/30 dark:bg-black text-gray-900 dark:text-gray-100">
        <AuthProvider>
          <Navbar />
          <main className="max-w-[1200px] mx-auto px-6 py-[60px]">
            <AuthGuard>{children}</AuthGuard>
          </main>
        </AuthProvider>
      </body>
    </html>
  )
}
