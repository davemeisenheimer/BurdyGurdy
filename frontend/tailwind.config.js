/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      animation: {
        'fade-in':        'fadeIn 0.4s ease-in-out',
        'caption-scroll': 'captionScroll 3.5s linear forwards',
        'caption-drop':   'captionDrop 3.2s ease-in-out forwards',
        'caption-rise':   'captionRise 3.2s ease-in-out forwards',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        captionScroll: {
          '0%':   { transform: 'translateX(110vw)',  opacity: '0' },
          '6%':   {                                  opacity: '1' },
          '85%':  {                                  opacity: '1' },
          '100%': { transform: 'translateX(-110vw)', opacity: '0' },
        },
        captionDrop: {
          '0%':   { transform: 'translateY(-50px)', opacity: '0' },
          '20%':  { transform: 'translateY(0px)',   opacity: '1' },
          '75%':  { transform: 'translateY(0px)',   opacity: '1' },
          '100%': {                                 opacity: '0' },
        },
        captionRise: {
          '0%':   { transform: 'translateY(50px)', opacity: '0' },
          '20%':  { transform: 'translateY(0px)',  opacity: '1' },
          '75%':  { transform: 'translateY(0px)',  opacity: '1' },
          '100%': {                                opacity: '0' },
        },
      },
      colors: {
        forest: {
          50: '#f0fdf4',
          100: '#dcfce7',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
        },
        sky: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          500: '#0ea5e9',
          600: '#0284c7',
        },
      },
    },
  },
  plugins: [],
};
