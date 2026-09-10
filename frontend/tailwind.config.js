/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#F5F5F7',
        surface: '#FFFFFF',
        primary: '#0071E3',
        textMain: '#1D1D1F',
        textMuted: '#6E6E73',
        status: {
          danger: '#FF3B30',
          warning: '#FF9500',
          success: '#34C759'
        }
      },
      borderRadius: {
        'apple': '18px',
        'apple-sm': '12px',
        'pill': '980px'
      },
      boxShadow: {
        'apple': '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)',
      }
    },
  },
  plugins: [],
}
