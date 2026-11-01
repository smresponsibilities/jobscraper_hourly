/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"DM Sans"', 'sans-serif'], serif: ['Georgia', '"Times New Roman"', 'serif'] },
    },
  },
  plugins: [],
};
