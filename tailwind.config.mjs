/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}'],
  theme: {
    extend: {
      colors: {
        navy: '#0A1929',
        moon: '#FFD600',
        pitch: '#00C853',
        panel: '#F8FAFC',
        slate: {
          DEFAULT: '#9FB2CA',
          dim: '#8A99AD',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
