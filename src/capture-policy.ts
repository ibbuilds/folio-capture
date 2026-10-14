import type { Config, Source } from './types.ts';
import { hash } from './utils.ts';

export function captureSignature(config: Config, source: Source, expectedHttpStatus?: 404) {
  return hash({
    version: 5,
    playwright: '1.62.1',
    profiles: config.profiles,
    ...(expectedHttpStatus ? { expectedHttpStatus } : {}),
    capture: {
      ...config.capture,
      preserveSelectors: [...config.capture.preserveSelectors, ...(source.preserveSelectors ?? [])],
      dismissSelectors: [...config.capture.dismissSelectors, ...(source.dismissSelectors ?? [])],
    },
  });
}
