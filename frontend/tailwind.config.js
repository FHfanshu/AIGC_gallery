/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#1A1A1A',
          secondary: '#4A4A4A',
          muted: '#8A8A8A',
          faint: '#C0C0C0',
          line: '#E8E8E8',
          bg: '#FFFFFF',
          surface: '#FAFAFA',
          accent: '#1A1A1A',
          'accent-soft': '#F5F5F5',
          danger: '#DC2626',
          success: '#16A34A',
        },
      },
      borderRadius: {
        'card': '4px',
        'btn': '4px',
        'pill': '9999px',
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        body: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'display-xl': ['2.5rem', { lineHeight: '1.1', letterSpacing: '-0.03em', fontWeight: '800' }],
        'display-lg': ['1.75rem', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '700' }],
        'display-md': ['1.25rem', { lineHeight: '1.3', letterSpacing: '-0.01em', fontWeight: '700' }],
        'caption': ['0.625rem', { lineHeight: '1.4', letterSpacing: '0.08em', fontWeight: '600' }],
      },
    },
  },
  plugins: [],
}
