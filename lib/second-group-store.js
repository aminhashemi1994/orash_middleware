'use strict';

/**
 * Where the editable reference tables live between restarts.
 *
 * public/second-group.js ships the table as first supplied; whatever the panel
 * saves is written here and takes over from then on. Keeping it in one file on
 * the server — rather than in each browser — is what makes a label printed from
 * Excel and a good registered from a phone use the same mapping.
 */

const fs = require('fs');
const path = require('path');

const secondGroup = require('../public/second-group.js');
const packing = require('../public/packing.js');

/**
 * Where settings live. `DATA_DIR` moves the whole lot somewhere a redeploy
 * cannot touch — /var/lib/orash-scan, say — while the default keeps a plain
 * checkout self-contained.
 */
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

const FILE = process.env.SECOND_GROUPS_FILE || path.join(DATA_DIR, 'second-groups.json');
const PACKING_FILE = process.env.PACKINGS_FILE || path.join(DATA_DIR, 'packings.json');
const DOC_DEFAULTS_FILE = process.env.DOC_DEFAULTS_FILE || path.join(DATA_DIR, 'doc-defaults.json');

/**
 * Write so a crash cannot leave half a file behind: the new content goes to a
 * temporary name, the previous version is kept as `.bak`, and only then does
 * the real name change — a rename within one directory is atomic.
 */
function saveJson(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  try { fs.copyFileSync(file, `${file}.bak`); } catch { /* nothing to back up yet */ }
  fs.renameSync(tmp, file);
}

/** Read a settings file, falling back to its `.bak` if the main one is broken. */
function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') throw err;
    try {
      const backup = JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8'));
      console.warn(`[settings] ${file} خوانده نشد (${err.message}) — از نسخه‌ی پشتیبان استفاده شد`);
      return backup;
    } catch { throw err; }
  }
}

/** Called once at startup so a permissions problem is loud, not silent. */
function ensureDataDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
    return { ok: true, dir: DATA_DIR };
  } catch (err) {
    return { ok: false, dir: DATA_DIR, error: err.message };
  }
}

/** @returns {{groups: Array, source: 'file'|'default', savedAt: string|null}} */
function read() {
  try {
    const raw = loadJson(FILE);
    const rows = Array.isArray(raw) ? raw : raw.groups;
    // A file that no longer validates must not silently replace the table: fall
    // back to the built-in one and say so, rather than print wrong labels.
    secondGroup.setGroups(rows);
    return { groups: secondGroup.getGroups(), source: 'file', savedAt: (raw && raw.savedAt) || null };
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[second-groups] ${FILE}: ${err.message} — از جدول پیش‌فرض استفاده شد`);
    secondGroup.setGroups(secondGroup.GROUPS);
    return { groups: secondGroup.getGroups(), source: 'default', savedAt: null };
  }
}

/** Validate, apply, then persist. Throws with every problem when invalid. */
function write(rows) {
  const groups = secondGroup.setGroups(rows);   // throws on a bad table
  const savedAt = new Date().toISOString();
  saveJson(FILE, { savedAt, groups });
  return { groups, source: 'file', savedAt };
}

/** @returns {{packings: Array, source: 'file'|'default', savedAt: string|null}} */
function readPackings() {
  try {
    const raw = loadJson(PACKING_FILE);
    packing.setPackings(Array.isArray(raw) ? raw : raw.packings);
    return { packings: packing.getPackings(), source: 'file', savedAt: (raw && raw.savedAt) || null };
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[packings] ${PACKING_FILE}: ${err.message} — از جدول پیش‌فرض استفاده شد`);
    packing.setPackings(packing.PACKINGS);
    return { packings: packing.getPackings(), source: 'default', savedAt: null };
  }
}

function writePackings(rows) {
  const packings = packing.setPackings(rows);   // throws on a bad table
  const savedAt = new Date().toISOString();
  saveJson(PACKING_FILE, { savedAt, packings });
  return { packings, source: 'file', savedAt };
}

/**
 * Which warehouse, branch, user and account a document starts with. Chosen once
 * in settings rather than guessed per document — picking the wrong warehouse is
 * not something a default should be able to do quietly.
 */
// `createuser` is not among them: a document is filed by whoever is signed in,
// so it comes from the session at submit time and is never stored as a default.
const DOC_DEFAULT_KEYS = ['kind', 'storageCode', 'departmentCode', 'accountCode'];

function readDocDefaults() {
  try {
    const raw = loadJson(DOC_DEFAULTS_FILE);
    const defaults = {};
    for (const k of DOC_DEFAULT_KEYS) if (raw[k] !== undefined) defaults[k] = String(raw[k]);
    return { defaults, source: 'file', savedAt: raw.savedAt || null };
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[doc-defaults] ${DOC_DEFAULTS_FILE}: ${err.message}`);
    return { defaults: {}, source: 'default', savedAt: null };
  }
}

function writeDocDefaults(input) {
  const defaults = {};
  for (const k of DOC_DEFAULT_KEYS) {
    const v = input && input[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') defaults[k] = String(v).trim();
  }
  const savedAt = new Date().toISOString();
  saveJson(DOC_DEFAULTS_FILE, { savedAt, ...defaults });
  return { defaults, source: 'file', savedAt };
}

module.exports = { read, write, FILE, readPackings, writePackings, PACKING_FILE,
  readDocDefaults, writeDocDefaults, DOC_DEFAULTS_FILE, ensureDataDir, DATA_DIR };
