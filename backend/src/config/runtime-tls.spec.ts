import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { assertRuntimeTls } from './runtime-tls';

describe('production outbound TLS policy', () => {
  it('does not change local development transport', () => {
    expect(() => assertRuntimeTls('development')).not.toThrow();
  });
  it.each(['TLSv1.2', 'TLSv1.3'])('checks the actual Node runtime %s', (version) => {
    const module = resolve(__dirname, 'runtime-tls.ts');
    const script = `try { require(${JSON.stringify(module)}).assertRuntimeTls('production'); process.stdout.write('accepted'); } catch { process.stdout.write('rejected'); }`;
    const result = execFileSync(process.execPath,
      [`--tls-min-v${version.slice(4)}`, '-r', 'ts-node/register', '-e', script],
      { encoding: 'utf8', timeout: 20000 });
    expect(result).toBe(version === 'TLSv1.3' ? 'accepted' : 'rejected');
  });
});
