import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { prepareLive2dAssets } from './scripts/prepare-live2d-assets.mjs'

export default defineConfig({
  main: {
    // yauzl is only used by the main-process model importer. Bundle it so the
    // ZIP stays self-contained; electron-builder excludes node_modules.
    plugins: [externalizeDepsPlugin({ exclude: ['yauzl'] })],
    build: {
      rollupOptions: {
        external: ['electron'],
        output: { format: 'cjs', entryFileNames: '[name].js' },
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'model-import-worker': resolve(__dirname, 'src/main/model-import-worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } }
    },
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer') } },
    plugins: [{ name: 'uta-live2d-assets', configResolved: () => prepareLive2dAssets() }, vue()]
  }
})
