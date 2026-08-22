import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Deployed to https://<user>.github.io/tankverkauf/ — keep base in sync with the repo name.
export default defineConfig({
  base: process.env.DEPLOY_BASE ?? '/tankverkauf/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    // The buyer page is a separate entry so no auth or dashboard code ships with it.
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        katalog: fileURLToPath(new URL('./katalog.html', import.meta.url)),
      },
    },
  },
})
