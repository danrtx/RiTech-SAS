import { readFileSync } from 'node:fs';
import { ConnectionOptions, createSecureContext } from 'node:tls';
import { isIP } from 'node:net';

/** Opt-in for local development; mandatory in production. Never disables verification. */
export function datastoreTls(
  get: (key: string) => string | undefined,
  prefix: 'DB' | 'REDIS',
): Pick<ConnectionOptions, 'minVersion' | 'rejectUnauthorized' | 'servername' | 'ca'> | undefined {
  const enabled = get(`${prefix}_TLS_ENABLED`);
  if (enabled !== undefined && enabled !== '' && !['true', 'false'].includes(enabled))
    throw new Error(`${prefix}_TLS_ENABLED must be true or false`);
  if (enabled !== 'true') {
    if (get('NODE_ENV') === 'production' || get(`${prefix}_TLS_CA_FILE`))
      throw new Error(`${prefix}_TLS_ENABLED=true is required`);
    return undefined;
  }
  const host = get(`${prefix}_HOST`) || 'localhost';
  const caPath = get(`${prefix}_TLS_CA_FILE`);
  let ca: string | undefined;
  if (caPath) {
    try {
      ca = readFileSync(caPath, 'utf8');
      if (!ca.includes('-----BEGIN CERTIFICATE-----')) throw new Error();
      createSecureContext({ ca });
    } catch {
      throw new Error(`${prefix}_TLS_CA_FILE must contain readable PEM certificates`);
    }
  }
  return { minVersion: 'TLSv1.3', rejectUnauthorized: true,
    ...(isIP(host) ? {} : { servername: host }), ...(ca ? { ca } : {}) };
}
