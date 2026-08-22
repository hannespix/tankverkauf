import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Deployed to https://<user>.github.io/tankverkauf/ — keep base in sync with the repo name.
export default defineConfig({
  base: process.env.DEPLOY_BASE ?? '/tankverkauf/',
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', sourcemap: false },
})
