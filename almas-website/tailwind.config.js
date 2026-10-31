/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: { DEFAULT: '1rem', sm: '1.5rem', lg: '2rem' }, screens: { '2xl': '1320px' } },
    extend: {
      colors: {
        ink: { 950: '#030408', 900: '#06080e', 850: '#0a0d15', 800: '#0e121c', 700: '#151a27', 600: '#1f2636' },
        volt: { 50: '#eaf2ff', 100: '#d4e5ff', 200: '#a9caff', 300: '#7aaeff', 400: '#4d8fff', 500: '#2f7bff', 600: '#1a5fe6', 700: '#1449b4', 800: '#123c8c', 900: '#0f2f6b' },
      },
      fontFamily: {
        display: ['"Readex Pro"', '"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'],
        sans: ['"IBM Plex Sans Arabic"', '"Readex Pro"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(47,123,255,.35), 0 10px 40px -10px rgba(47,123,255,.55)',
        'glow-lg': '0 0 80px -10px rgba(47,123,255,.6)',
      },
      keyframes: {
        shimmer: { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(100%)' } },
        pulseGlow: { '0%,100%': { opacity: '.55' }, '50%': { opacity: '1' } },
        marquee: { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } },
      },
      animation: {
        shimmer: 'shimmer 2.4s ease-in-out infinite',
        'pulse-glow': 'pulseGlow 3s ease-in-out infinite',
        marquee: 'marquee 40s linear infinite',
      },
    },
  },
  plugins: [],
};
