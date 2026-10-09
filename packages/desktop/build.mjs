import { build } from 'esbuild';
import { rmSync } from 'node:fs';

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: false,
  logLevel: 'info',
};

rmSync('dist', { recursive: true, force: true });

await build({
  ...common,
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.cjs',
  // electron 由运行时提供；playwright-core 仅独立 server 用（桌面走 Electron host），不打包
  external: ['electron', 'playwright-core'],
});

await build({
  ...common,
  entryPoints: ['src/preload.ts'],
  outfile: 'dist/preload.cjs',
  external: ['electron'],
});
