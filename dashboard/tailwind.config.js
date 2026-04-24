/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb"
        }
      }
    }
  },
  plugins: []
};
