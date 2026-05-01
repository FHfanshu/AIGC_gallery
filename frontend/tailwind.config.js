/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        neu: {
          bg: '#E0E5EC',
          surface: '#E0E5EC',
          text: '#3D4852',
          muted: '#6B7280',
          accent: '#6C63FF',
          'accent-light': '#8B84FF',
          success: '#38B2AC',
          danger: '#E53E3E',
        }
      },
      borderRadius: {
        'neu-card': '32px',
        'neu-btn': '16px',
        'neu-sm': '12px',
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        body: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
