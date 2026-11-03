import type { AiloApi } from '../../shared/types';

declare global {
  interface Window {
    ailo: AiloApi;
  }
}

export const api = window.ailo;
