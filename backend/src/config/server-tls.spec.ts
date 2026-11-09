import { serverTls } from './server-tls';

describe('server TLS configuration', () => {
  const config = (values: Record<string, string | undefined>) => (key: string) => values[key];
  it('allows HTTP only for local development without certificate configuration', () => {
    expect(serverTls(config({}))).toBeUndefined();
  });
  it.each([
    { NODE_ENV: 'production' },
    { NODE_ENV: 'production', SERVER_TLS_ENABLED: 'false' },
    { SERVER_TLS_CERT_FILE: 'certificate.pem' },
    { SERVER_TLS_KEY_FILE: 'private.pem' },
    { SERVER_TLS_ENABLED: 'yes' },
    { SERVER_TLS_ENABLED: 'true' },
  ])('fails closed on incomplete or insecure configuration: %j', (values) => {
    expect(() => serverTls(config(values))).toThrow();
  });
});
