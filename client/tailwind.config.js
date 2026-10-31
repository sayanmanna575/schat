/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#070a13',
          900: '#0b1120',
          850: '#0f172a',
          800: '#151f32',
          700: '#1e293b',
          600: '#334155',
        },
        cyan: {
          accent: '#06b6d4',
          bright: '#22d3ee',
          glow: '#0891b2',
          dark: '#0e7490',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
