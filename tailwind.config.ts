import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#05070b',
          900: '#0b1017',
          850: '#111824',
        },
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(34,211,238,0.14), 0 24px 80px rgba(0,0,0,0.28)',
      },
    },
  },
  plugins: [],
}

export default config
