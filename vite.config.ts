import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

const getGitCommitHash = () => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
};

const buildDate = new Date().toISOString();
const buildCommit = getGitCommitHash();

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __APP_BUILD_DATE__: JSON.stringify(buildDate),
    __APP_BUILD_COMMIT__: JSON.stringify(buildCommit)
  }
});
