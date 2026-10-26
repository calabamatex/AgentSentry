import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f5f5f5',
          100: '#e5e5e5',
          200: '#a3a3a3',
          300: '#737373',
          400: '#525252',
          500: '#262626',
          600: '#171717',
          700: '#0f0f0f',
          800: '#0a0a0a',
          900: '#050505',
        },
        accent: '#e8e8e8',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jbm)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      maxWidth: {
        site: '1120px',
        'prose-tight': '65ch',
      },
      letterSpacing: {
        tightest: '-0.04em',
      },
    },
  },
  plugins: [],
};

export default config;
