'use strict';

/**
 * Where the sub-group table lives between restarts.
 *
 * public/second-group.js ships the table as first supplied; whatever the panel
 * saves is written here and takes over from then on. Keeping it in one file on
 * the server — rather than in each browser — is what makes a label printed from
 * Excel and a good registered from a phone use the same mapping.
 */

const fs = require('fs');
const path = require('path');

const secondGroup = require('../public/second-group.js');

const FILE = process.env.SECOND_GROUPS_FILE
  || path.join(__dirname, '..', 'data', 'second-groups.json');

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

module.exports = { read, write, FILE };
