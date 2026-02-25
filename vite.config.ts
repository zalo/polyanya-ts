import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/polyanya-ts/" : "/",
  plugins: [react()],
  optimizeDeps: {
    exclude: ["bun-match-svg"],
  },
})
