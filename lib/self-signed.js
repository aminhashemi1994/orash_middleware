'use strict';

/**
 * Self-signed certificate helper.
 *
 * Why HTTPS at all: a phone can only open its camera from a *secure context*.
 * http://<lan-ip>:4173 is not one, so the phone scanner page needs TLS. The
 * cert is generated once with the local openssl binary (present on Linux/macOS,
 * shipped with Git for Windows) and reused until the machine's LAN IPs change.
 *
 * If openssl is missing the caller falls back to HTTP-only and the panel
 * explains the options in the UI.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function lanIPv4() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out.sort();
}

function opensslAvailable() {
  const bin = process.env.OPENSSL_BIN || 'openssl';
  const r = spawnSync(bin, ['version'], { encoding: 'utf8' });
  return r.status === 0 ? bin : null;
}

function buildConfig(ips) {
  const alt = ['DNS.1 = localhost', 'DNS.2 = *.local', 'IP.1 = 127.0.0.1'];
  ips.forEach((ip, i) => alt.push(`IP.${i + 2} = ${ip}`));
  return [
    '[req]', 'distinguished_name = dn', 'x509_extensions = v3_req', 'prompt = no', '',
    '[dn]', 'CN = Orash Panel', 'O = Orash Local Panel', '',
    '[v3_req]',
    'basicConstraints = critical,CA:FALSE',
    'keyUsage = critical,digitalSignature,keyEncipherment',
    'extendedKeyUsage = serverAuth',
    'subjectAltName = @alt', '',
    '[alt]', ...alt, '',
  ].join('\n');
}

/**
 * Returns { key, cert, ips, generated } or null when it cannot be produced.
 * Honours TLS_KEY / TLS_CERT for a user-supplied certificate.
 */
function ensureCert(dir) {
  if (process.env.TLS_KEY && process.env.TLS_CERT) {
    try {
      return {
        key: fs.readFileSync(process.env.TLS_KEY),
        cert: fs.readFileSync(process.env.TLS_CERT),
        ips: lanIPv4(),
        generated: false,
        source: 'TLS_KEY/TLS_CERT',
      };
    } catch (err) {
      console.error('[tls] cannot read TLS_KEY/TLS_CERT:', err.message);
      return null;
    }
  }

  const ips = lanIPv4();
  const keyPath = path.join(dir, 'key.pem');
  const certPath = path.join(dir, 'cert.pem');
  const metaPath = path.join(dir, 'sans.json');
  const want = JSON.stringify(ips);

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    let same = false;
    try { same = fs.readFileSync(metaPath, 'utf8') === want; } catch { /* regenerate */ }
    if (same) {
      return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath), ips, generated: false, source: dir };
    }
    console.log('[tls] LAN addresses changed — regenerating certificate');
  }

  const bin = opensslAvailable();
  if (!bin) return null;

  fs.mkdirSync(dir, { recursive: true });
  const cfgPath = path.join(dir, 'openssl.cnf');
  fs.writeFileSync(cfgPath, buildConfig(ips));

  const r = spawnSync(bin, [
    'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-days', '825', '-nodes',
    '-keyout', keyPath, '-out', certPath, '-config', cfgPath, '-extensions', 'v3_req',
  ], { encoding: 'utf8' });

  if (r.status !== 0) {
    console.error('[tls] openssl failed:', (r.stderr || r.error?.message || '').trim());
    return null;
  }
  fs.writeFileSync(metaPath, want);
  try { fs.chmodSync(keyPath, 0o600); } catch { /* windows */ }

  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath), ips, generated: true, source: dir };
}

module.exports = { ensureCert, lanIPv4, opensslAvailable };
