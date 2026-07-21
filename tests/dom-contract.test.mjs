import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'assets/app.js'), 'utf8');

const idList = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const ids = new Set(idList);
assert.equal(ids.size, idList.length, 'HTML ids must be unique');

const staticIdSelectors = new Set([...script.matchAll(/\$\('#([^']+)'/g)].map((match) => match[1]));
assert.ok(staticIdSelectors.size > 40, 'Expected the application selector contract to be exercised');
const missingIds = [...staticIdSelectors].filter((id) => !ids.has(id));
assert.deepEqual(missingIds, [], `Missing HTML ids: ${missingIds.join(', ')}`);

const navigationViews = new Set([...html.matchAll(/\bdata-view="([^"]+)"/g)].map((match) => match[1]));
const panelViews = new Set([...html.matchAll(/\bdata-view-panel="([^"]+)"/g)].map((match) => match[1]));
assert.deepEqual([...navigationViews].sort(), [...panelViews].sort());

for (const match of html.matchAll(/\b(?:src|href)="(\.\/[^"#?]+)"/g)) {
  const relativePath = match[1].slice(2);
  assert.equal(fs.existsSync(path.join(root, relativePath)), true, `Missing local resource: ${relativePath}`);
}

for (const legacyPath of ['data.json', 'css', 'js', 'img']) {
  assert.equal(fs.existsSync(path.join(root, legacyPath)), false, `Legacy asset remains: ${legacyPath}`);
}

assert.match(html, /Content-Security-Policy/);
assert.match(html, /name="referrer" content="no-referrer"/);
assert.match(html, /id="detailDrawer"[^>]*\binert\b/);

console.log(`DOM contract passed: ${staticIdSelectors.size} selectors, ${panelViews.size} views, local resources present`);
