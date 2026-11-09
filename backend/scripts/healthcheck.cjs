// Probe this container over verified TLS, keeping the certificate's hostname.
const https = require('node:https');
const fs = require('node:fs');
try {
  const caFile = process.env.SERVER_TLS_HEALTH_CA_FILE;
  const request = https.get({ hostname: '127.0.0.1',
    port: Number(process.env.PORT || 3000), path: '/health',
    servername: process.env.SERVER_TLS_HEALTH_HOST || 'localhost',
    minVersion: 'TLSv1.3', rejectUnauthorized: true,
    ...(caFile ? { ca: fs.readFileSync(caFile) } : {}) }, response => {
    response.resume();
    if (response.statusCode !== 200) process.exitCode = 1;
  });
  request.setTimeout(4000, () => request.destroy(new Error('timeout')));
  request.on('error', () => { process.exitCode = 1; });
} catch { process.exitCode = 1; }
