import type { DesktopApi } from '../shared.js';

declare global {
  interface Window {
    mplus: DesktopApi;
  }
}
