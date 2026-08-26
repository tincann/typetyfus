import { defineConfig } from '@playwright/test'

const PORT = 4173

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  // WebRTC connections are established once and reused across assertions in a
  // single test; running specs in parallel on one machine makes ICE flakier
  // without buying much, since there is only one spec.
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: {
      args: [
        // Chrome replaces local IPs with unresolvable mDNS .local names unless
        // media permission is granted. Two contexts on one machine then never
        // complete connectivity checks. Disabling it exposes real host
        // candidates so loopback works, which is the standard approach for
        // WebRTC end-to-end testing.
        '--disable-features=WebRtcHideLocalIpsWithMdns',
      ],
    },
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
})
