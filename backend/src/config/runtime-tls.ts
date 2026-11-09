import { DEFAULT_MIN_VERSION } from 'node:tls';

/** Covers native fetch and SDK HTTPS clients in addition to explicit WS/DB policies. */
export function assertRuntimeTls(environment: string | undefined) {
  if (environment === 'production' && DEFAULT_MIN_VERSION !== 'TLSv1.3') {
    throw new Error('Production requires Node --tls-min-v1.3 (use npm run start:prod)');
  }
}
