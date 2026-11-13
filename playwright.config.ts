import { defineConfig } from '@playwright/test';

// HEADED=1: a visible window on the real GPU, for the frame-rate check; otherwise headless software rendering
const headed = process.env.HEADED === '1';

export default defineConfig({
  testDir: 'test/e2e',
  // one browser at a time: parallel workers time out creating contexts under software rendering
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    channel: 'chrome',
    headless: !headed,
    launchOptions: {
      args: headed ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: 'vite build && vite preview --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
