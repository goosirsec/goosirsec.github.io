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
  aadhaarValid,
  bicValid,
  chinaIdChecksum,
  clabeValid,
  createPdf,
  createInitialRecords,
  csvCell,
  exportPng,
  ibanValid,
  luhnValid,
  myNumberValid,
  passportMrzValid,
  presentRecord,
} = context.__BROWSER_LAB_TEST_API__;

for (const formula of ['=1+1', '+cmd', '-2+3', '@SUM(A1:A2)', '  =HYPERLINK("https://example.test")']) {
  const encoded = csvCell(formula);
  assert.equal(encoded.startsWith('"\''), true, `CSV formula was not neutralized: ${formula}`);
}
assert.equal(csvCell('ordinary'), '"ordinary"');

const records = createInitialRecords();
assert.equal(records.length, 48);
assert.equal(new Set(records.map((record) => record.country)).size, 16);
const ibanCountries = new Set(['AE', 'BR', 'DE', 'FR', 'GB', 'TR']);
for (const record of records) {
  assert.ok(record.name.length > 1);
  assert.ok(record.latinName.length > 2);
  assert.ok(record.country.length > 0);
  assert.ok(record.idType.length > 0);
  assert.ok(record.idCard.length > 5);
  assert.ok(record.passport.length >= 7);
  assert.doesNotMatch(record.idCard, /\*/);
  assert.doesNotMatch(record.phone, /TEST|\*/);
  assert.equal(luhnValid(record.bankCard), true, `${record.country} test PAN must pass Luhn`);
  assert.match(record.cardExpiry, /^12\/3[3-5]$/);
  assert.equal(record.cardCvc.length, record.cardBrand === 'American Express' ? 4 : 3);
  assert.match(record.currency, /^[A-Z]{3}$/);
  assert.ok(record.bankName.includes('Mock International Bank'));
  assert.match(record.bankAccount, /^[A-Z0-9]+$/);
  assert.equal(bicValid(record.swift), true, `${record.country} BIC must match ISO 9362 structure`);
  assert.equal(record.swift.slice(4, 6), record.bankCountryCode);
  if (ibanCountries.has(record.bankCountryCode)) {
    assert.equal(ibanValid(record.iban), true, `${record.country} IBAN must pass MOD-97 and country length`);
    assert.equal(record.iban.slice(0, 2), record.bankCountryCode);
  } else {
    assert.equal(record.iban, 'N/A (NON-IBAN COUNTRY)');
  }
  assert.equal(passportMrzValid(record.passportMrz1, record.passportMrz2), true, `${record.country} MRZ must validate`);
  assert.equal(record.passportMrz2.slice(10, 13), record.passportCountryCode);
  assert.equal(record.source, 'builtin-mock');
  assert.equal(record.schemaVersion, 5);
}

records.filter((record) => record.country === '印度').forEach((record) => assert.equal(aadhaarValid(record.idCard), true));
records.filter((record) => record.country === '日本').forEach((record) => assert.equal(myNumberValid(record.idCard), true));
records.filter((record) => record.country === '墨西哥').forEach((record) => assert.equal(clabeValid(record.bankAccount), true));

const chinaRecords = records.filter((record) => record.country === '中国');
assert.equal(chinaRecords.length, 3);
for (const record of chinaRecords) {
  assert.match(record.idCard, /^11010119900101\d{3}[0-9X]$/);
  assert.equal(record.idCard.at(-1), chinaIdChecksum(record.idCard.slice(0, 17)));
  assert.match(record.phone, /^13800138\d{3}$/);
  assert.equal(record.idCard.slice(6, 14), record.dateOfBirth.replaceAll('-', ''));
}

const masked = presentRecord(records[0], true);
assert.notEqual(masked.name, records[0].name);
assert.notEqual(masked.idCard, records[0].idCard);
assert.notEqual(masked.phone, records[0].phone);
assert.equal(presentRecord(records[0], false).name, records[0].name);
assert.equal(presentRecord(records[0], false).idCard, records[0].idCard);
assert.doesNotMatch(JSON.stringify(presentRecord(records[0], false)), /\*{2,}/);

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

console.log('security tests passed: Luhn PANs, country-aware IBAN/BIC, passport MRZ, identity consistency, CSV, PDF, Canvas');
