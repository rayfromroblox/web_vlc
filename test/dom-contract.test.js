const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(projectRoot, 'public', 'app.js'), 'utf8');
const pageSource = fs.readFileSync(path.join(projectRoot, 'public', 'index.html'), 'utf8');

test('every DOM ID used by app.js exists in index.html', () => {
  const referencedIds = [...appSource.matchAll(/getElementById\('([^']+)'\)/g)].map((match) => match[1]);
  const pageIds = new Set([...pageSource.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
  const missingIds = referencedIds.filter((id) => !pageIds.has(id));
  assert.deepEqual(missingIds, []);
});

test('page IDs are unique', () => {
  const pageIds = [...pageSource.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = pageIds.filter((id, index) => pageIds.indexOf(id) !== index);
  assert.deepEqual(duplicates, []);
});
