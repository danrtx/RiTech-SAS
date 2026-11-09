import { readFileSync } from 'node:fs';
import { createSecureContext, SecureContextOptions } from 'node:tls';

/** HTTP remains available for local development; production must serve TLS. */
export function serverTls(
  get: (key: string) => string | undefined,
): SecureContextOptions | undefined {
  const enabled = get('SERVER_TLS_ENABLED');
  if (enabled !== undefined && enabled !== '' && !['true', 'false'].includes(enabled))
    throw new Error('SERVER_TLS_ENABLED must be true or false');
  if (enabled !== 'true') {
    if (get('NODE_ENV') === 'production' || get('SERVER_TLS_CERT_FILE') || get('SERVER_TLS_KEY_FILE'))
      throw new Error('SERVER_TLS_ENABLED=true is required');
    return undefined;
  }
  try {
    const cert = readFileSync(get('SERVER_TLS_CERT_FILE') || '');
    const key = readFileSync(get('SERVER_TLS_KEY_FILE') || '');
    const options: SecureContextOptions = { cert, key, minVersion: 'TLSv1.3' };
    createSecureContext(options);
    return options;
  } catch {
    throw new Error('Server TLS requires readable PEM certificate and matching private key');
  }
}
