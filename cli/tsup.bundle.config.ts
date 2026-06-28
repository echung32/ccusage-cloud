import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  splitting: false,
  minify: true,
  outDir: 'bundle',
  clean: true,
  // Inline ALL dependencies so the bundle is fully self-contained
  // (runs in a directory with no node_modules, e.g. ~/.config/ccusage-cloud/).
  noExternal: [/./],
});
