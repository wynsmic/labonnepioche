import { defineConfig } from 'vitest/config';

// Unit tests run in plain Node, without the Cloudflare plugin of vite.config.ts.
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
