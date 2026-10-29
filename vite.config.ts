import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

function commit(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'local';
  }
}

export default defineConfig({
  plugins: [react()],
  // Shown in the tabulation so the exact build in use on tournament day can be identified.
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(commit()),
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  test: {
    exclude: ['node_modules/**', 'dist/**', 'e2e/**'],
    coverage: {
      provider: 'v8',
      include: ['src/tabulation/**/*.ts'],
      exclude: ['src/tabulation/**/*.test.ts', 'src/tabulation/test-fixtures.ts', 'src/tabulation/useTabStore.ts'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 80 },
    },
  },
});
