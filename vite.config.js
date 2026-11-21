
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/shortsnip/',

  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@ffmpeg/core']
  },

  worker: {
    format: 'es'
  }
});
