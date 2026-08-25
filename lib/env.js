'use strict';

/**
 * Minimal .env loader.
 *
 * Node 20.6+ has --env-file and Node 21+ has process.loadEnvFile(), but this
 * project runs from a plain `node server.js` (and systemd, and npm scripts), so
 * it reads the file itself. No dependency, and the parsing rules are the common
 * subset every .env tool agrees on:
 *
 *   KEY=value            # comment
 *   KEY="quoted value"   escapes \n \t \" inside double quotes
 *   KEY='raw value'      no escapes inside single quotes
 *   export KEY=value     the `export` prefix is ignored
 *
 * A variable already present in the real environment always wins, so
 * `PORT=5000 node server.js` still overrides the file.
 */

const fs = require('fs');
const path = require('path');

function parse(text) {
  const out = {};
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
      value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
    } else if (value.startsWith("'") && value.endsWith("'") && value.length > 1) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();   // trailing comment
    }
    out[key] = value;
  }
  return out;
}

/**
 * Loads .env into process.env without overwriting existing variables.
 * @returns {{file: string|null, loaded: string[]}}
 */
function load(file) {
  const target = file || process.env.ENV_FILE || path.join(__dirname, '..', '.env');
  let text;
  try {
    text = fs.readFileSync(target, 'utf8');
  } catch {
    return { file: null, loaded: [] };
  }

  const loaded = [];
  for (const [k, v] of Object.entries(parse(text))) {
    if (process.env[k] === undefined) {
      process.env[k] = v;
      loaded.push(k);
    }
  }
  return { file: target, loaded };
}

module.exports = { load, parse };
