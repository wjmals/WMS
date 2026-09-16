import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '../context/AuthContext'
import Navbar from '../components/Navbar'
import AuthGuard from '../components/AuthGuard'

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
