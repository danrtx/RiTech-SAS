import { datastoreTls } from './datastore-tls';

describe('datastore TLS policy', () => {
  const options = (env: Record<string, string>, prefix: 'DB' | 'REDIS' = 'DB') =>
    datastoreTls(key => env[key], prefix);
  it.each(['DB', 'REDIS'] as const)('requires TLS for %s in production', prefix => {
    expect(() => options({ NODE_ENV: 'production' }, prefix)).toThrow('required');
    expect(() => options({ NODE_ENV: 'production', [`${prefix}_TLS_ENABLED`]: 'false' }, prefix)).toThrow('required');
    expect(options({ NODE_ENV: 'production', [`${prefix}_TLS_ENABLED`]: 'true', [`${prefix}_HOST`]: 'store.example' }, prefix))
      .toMatchObject({ minVersion: 'TLSv1.3', rejectUnauthorized: true, servername: 'store.example' });
  });
  it('preserves local plaintext development only when not enabled', () => {
    expect(options({ NODE_ENV: 'test' })).toBeUndefined();
  });
  it('rejects typos and CA configuration without TLS', () => {
    expect(() => options({ DB_TLS_ENABLED: 'yes' })).toThrow('true or false');
    expect(() => options({ DB_TLS_CA_FILE: 'missing.pem' })).toThrow('required');
  });
  it('fails closed on unreadable CA and does not expose its path', () => {
    expect(() => options({ DB_TLS_ENABLED: 'true', DB_TLS_CA_FILE: 'private-missing-path.pem' }))
      .toThrow('DB_TLS_CA_FILE must contain readable PEM certificates');
  });
  it('does not send an IP address as SNI', () => {
    expect(options({ DB_TLS_ENABLED: 'true', DB_HOST: '127.0.0.1' }))
      .toEqual({ minVersion: 'TLSv1.3', rejectUnauthorized: true });
  });
});
