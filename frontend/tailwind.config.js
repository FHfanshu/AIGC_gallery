/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: 'rgb(var(--color-ink) / <alpha-value>)',
          secondary: 'rgb(var(--color-ink-secondary) / <alpha-value>)',
          muted: 'rgb(var(--color-ink-muted) / <alpha-value>)',
          faint: 'rgb(var(--color-ink-faint) / <alpha-value>)',
          line: 'rgb(var(--color-ink-line) / <alpha-value>)',
          bg: 'rgb(var(--color-ink-bg) / <alpha-value>)',
          surface: 'rgb(var(--color-ink-surface) / <alpha-value>)',
          accent: 'rgb(var(--color-ink) / <alpha-value>)',
          'accent-soft': 'rgb(var(--color-ink-accent-soft) / <alpha-value>)',
          danger: 'rgb(var(--color-ink-danger) / <alpha-value>)',
          success: 'rgb(var(--color-ink-success) / <alpha-value>)',
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
