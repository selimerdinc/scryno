import type { ScrynoApi } from './index'

declare global {
  interface Window {
    scryno: ScrynoApi
  }
}

export {}
