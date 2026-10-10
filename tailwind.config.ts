import type { Config } from "tailwindcss";

/**
 * FleetComply palette
 *   navy      #142D4E — navigation, headers, key interface elements
 *   brand     #3478F6 — electric blue: primary buttons, links, interactive elements
 *   accent    #16B8A6 — vibrant teal: success, completed, subtle highlights
 *   highlight #F4B544 — warm amber: deadlines, featured, attention
 *   canvas    #F5F7FB — page background
 */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { 50: "#eef4ff", 100: "#dce8fe", 200: "#bcd3fd", 300: "#8fb5fa", 400: "#5c93f8", 500: "#3478f6", 600: "#3478f6", 700: "#1f5fd6", 800: "#1a4cab", 900: "#173f88" },
        navy: { 50: "#eef3f9", 100: "#d5e0ee", 300: "#7f9cc2", 500: "#2d5384", 700: "#1b3a63", 800: "#142d4e", 900: "#0d1f37", 950: "#081426" },
        accent: { 50: "#e8faf7", 100: "#c6f2eb", 500: "#16b8a6", 600: "#0f9a8b", 700: "#0d7c70" },
        highlight: { 50: "#fef7e8", 100: "#fdebc4", 400: "#f4b544", 500: "#e59e1f", 700: "#9a6410" },
        canvas: "#f5f7fb",
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
      boxShadow: {
        card: "0 1px 2px rgba(20,45,78,0.04), 0 1px 3px rgba(20,45,78,0.06)",
        lift: "0 4px 12px -2px rgba(20,45,78,0.10), 0 2px 4px -2px rgba(20,45,78,0.06)",
        search: "0 10px 40px -10px rgba(8,20,38,0.45), 0 2px 6px rgba(8,20,38,0.12)",
      },
    },
  },
  plugins: [],
} satisfies Config;
