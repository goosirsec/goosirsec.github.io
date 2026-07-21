import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/app.js', import.meta.url), 'utf8');
const toast = { textContent: '', hidden: true };
const context = {
  __BROWSER_LAB_TEST__: true,
  Blob,
  document: {
    addEventListener() {},
    querySelector(selector) { return selector === '#toast' ? toast : null; },
    querySelectorAll() { return []; },
  },
  window: {
    clearTimeout() {},
    setTimeout() { return 1; },
  },
};
vm.runInNewContext(source, context, { filename: 'assets/app.js' });

const {
  chinaIdChecksum,
  createPdf,
  createInitialRecords,
  csvCell,
  exportPng,
  presentRecord,
} = context.__BROWSER_LAB_TEST_API__;

for (const formula of ['=1+1', '+cmd', '-2+3', '@SUM(A1:A2)', '  =HYPERLINK("https://example.test")']) {
  const encoded = csvCell(formula);
  assert.equal(encoded.startsWith('"\''), true, `CSV formula was not neutralized: ${formula}`);
}
assert.equal(csvCell('ordinary'), '"ordinary"');

const records = createInitialRecords();
assert.equal(records.length, 40);
assert.equal(new Set(records.map((record) => record.idCard)).size, 40);
for (const record of records) {
  assert.match(record.name, /^测试用户\d{3}$/);
  assert.equal(record.source, 'builtin-mock');
  assert.equal(record.schemaVersion, 3);
  assert.match(record.idCard, /^990000\d{11}[0-9X]$/);
  assert.equal(record.idCard.at(-1), chinaIdChecksum(record.idCard.slice(0, 17)));
  assert.match(record.phone, /^000-TEST-\d{4}$/);
}

const masked = presentRecord(records[0], true);
assert.notEqual(masked.name, records[0].name);
assert.notEqual(masked.idCard, records[0].idCard);
assert.notEqual(masked.phone, records[0].phone);
assert.equal(presentRecord(records[0], false).name, records[0].name);

const pdfText = await createPdf([{ ...records[0], customerId: 'MOCK-中文-(TEST)' }]).text();
assert.doesNotMatch(pdfText, /[^\x00-\x7F]/);
const startXref = Number(pdfText.match(/startxref\n(\d+)\n%%EOF$/)?.[1]);
assert.equal(pdfText.slice(startXref, startXref + 4), 'xref');
const objectOffsets = [...pdfText.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
assert.equal(objectOffsets.length, 5);
objectOffsets.forEach((offset, index) => assert.equal(pdfText.slice(offset).startsWith(`${index + 1} 0 obj`), true));

context.document.createElement = () => ({ getContext: () => null });
assert.equal(await exportPng(records[0]), false);

const drawingContext = {
  fillRect() {},
  fillText() {},
  restore() {},
  rotate() {},
  save() {},
  strokeRect() {},
  translate() {},
};
context.document.createElement = () => ({
  getContext: () => drawingContext,
  toBlob(callback) { callback(null); },
});
assert.equal(await exportPng(records[0]), false);

console.log('security tests passed: CSV, fixtures, masking, PDF xref, Canvas failure paths');
