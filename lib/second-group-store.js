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

const FILE = process.env.SECOND_GROUPS_FILE
  || path.join(__dirname, '..', 'data', 'second-groups.json');
const PACKING_FILE = process.env.PACKINGS_FILE
  || path.join(__dirname, '..', 'data', 'packings.json');
const DOC_DEFAULTS_FILE = process.env.DOC_DEFAULTS_FILE
  || path.join(__dirname, '..', 'data', 'doc-defaults.json');

/** @returns {{groups: Array, source: 'file'|'default', savedAt: string|null}} */
function read() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
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
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ savedAt, groups }, null, 2), 'utf8');
  return { groups, source: 'file', savedAt };
}

/** @returns {{packings: Array, source: 'file'|'default', savedAt: string|null}} */
function readPackings() {
  try {
    const raw = JSON.parse(fs.readFileSync(PACKING_FILE, 'utf8'));
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
  fs.mkdirSync(path.dirname(PACKING_FILE), { recursive: true });
  fs.writeFileSync(PACKING_FILE, JSON.stringify({ savedAt, packings }, null, 2), 'utf8');
  return { packings, source: 'file', savedAt };
}

/**
 * Which warehouse, branch, user and account a document starts with. Chosen once
 * in settings rather than guessed per document — picking the wrong warehouse is
 * not something a default should be able to do quietly.
 */
const DOC_DEFAULT_KEYS = ['kind', 'storageCode', 'departmentCode', 'createuser', 'accountCode'];

function readDocDefaults() {
  try {
    const raw = JSON.parse(fs.readFileSync(DOC_DEFAULTS_FILE, 'utf8'));
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
  fs.mkdirSync(path.dirname(DOC_DEFAULTS_FILE), { recursive: true });
  fs.writeFileSync(DOC_DEFAULTS_FILE, JSON.stringify({ savedAt, ...defaults }, null, 2), 'utf8');
  return { defaults, source: 'file', savedAt };
}

module.exports = { read, write, FILE, readPackings, writePackings, PACKING_FILE,
  readDocDefaults, writeDocDefaults, DOC_DEFAULTS_FILE };
