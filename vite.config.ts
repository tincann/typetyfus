import { defineConfig } from 'vitest/config'

// Honour PORT so tooling that assigns a free port (previews, CI) is obeyed
// rather than silently falling back to Vite's own port search.
const port = Number(process.env['PORT']) || 5173

export default defineConfig({
  base: './',
  server: { port, strictPort: false },
  preview: { port },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
