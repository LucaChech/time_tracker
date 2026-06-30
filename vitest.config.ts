import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

/**
 * Vitest runs the Stage-2 state engine in isolation from Electron. The engine
 * is pure + dependency-injected (`now()` and the storage dir are parameters),
 * so a plain Node environment with no Electron bootstrapping is all it needs.
 *
 * The `@shared` alias mirrors the electron-vite / tsconfig path mapping so test
 * and source files import the data model the same way the app does.
 */
export default defineConfig({
  resolve: {
    alias: { '@shared': resolve('src/shared') }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
