import type { CadenceApi } from '@shared/ipc'

declare global {
  interface Window {
    cadence: CadenceApi
  }
}
