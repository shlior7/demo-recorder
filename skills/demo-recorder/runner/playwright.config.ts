import { defineConfig } from '@playwright/test';

// Driven entirely by env from record-demo.sh — no per-project config needed.
const [width, height] = (process.env.DEMO_VIEWPORT ?? '1680x1050').split('x').map(Number);
const size = { width, height };

export default defineConfig({
  testDir: process.env.DEMO_TEST_DIR,
  // lets any spec, wherever it lives, `import { test, demo } from 'demo-recorder'`
  tsconfig: process.env.DEMO_TSCONFIG,
  outputDir: process.env.DEMO_OUTPUT_DIR,
  timeout: Number(process.env.DEMO_TIMEOUT_MS ?? 600_000),
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.DEMO_BASE_URL,
    storageState: process.env.DEMO_STORAGE_STATE || undefined,
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000, // a bad selector fails fast instead of stalling the take
    // Wide desktop viewport so the app records roomy, not the cramped 1280 default; video 1:1.
    viewport: size,
    video: process.env.DEMO_NO_VIDEO ? 'off' : { mode: 'on', size },
    colorScheme: (process.env.DEMO_COLOR_SCHEME as 'light' | 'dark' | undefined) ?? 'light',
  },
});
