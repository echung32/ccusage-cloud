import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  output: 'static',
  integrations: [react()],
  vite: { ssr: { noExternal: ['@cloudscape-design/components', '@cloudscape-design/component-toolkit'] } },
});
