(() => {
  'use strict';

  const STORAGE_KEY = 'aml-browser-lab:kyc:v5';
  const SESSION_LOG_KEY = 'aml-browser-lab:session-log:v1';
  const PAGE_SIZE = 10;
  const RAW_CONFIRM_TEXT = '导出完整MOCK测试数据';
  const RAW_COPY_CONFIRM_TEXT = '复制完整MOCK测试数据';
  const MASKED_FIELDS = ['name', 'latinName', 'dateOfBirth', 'idCard', 'passport', 'passportMrz1', 'passportMrz2', 'phone', 'email', 'bankCard', 'cardExpiry', 'cardCvc', 'bankAccount', 'iban', 'swift', 'address'];
  const EXPORT_FIELDS = ['customerId', 'country', 'nationality', 'name', 'latinName', 'sex', 'dateOfBirth', 'risk', 'idType', 'idCard', 'passport', 'passportExpiry', 'passportMrz1', 'passportMrz2', 'phone', 'email', 'bankName', 'bankCountryCode', 'cardBrand', 'cardFunding', 'bankCard', 'cardExpiry', 'cardCvc', 'currency', 'bankCodeType', 'bankCode', 'bankAccount', 'iban', 'swift', 'address', 'company', 'occupation'];
  const DIRECT_IMAGE_SRC = './assets/mock-id-direct.svg';
  const COMPARISON_RECORD = Object.freeze({
    country: 'TESTLAND',
    idType: 'Synthetic Identity Card',
    name: 'ALEX MOCK',
    latinName: 'ALEX MOCK',
    dateOfBirth: '1990-01-01',
    idCard: 'TST-9000-0001',
    nationality: 'TESTLAND',
    phone: '+1 202-555-0199',
    customerId: 'KYC-MOCK-COMPARE-001',
  });

  const state = {
    records: [],
    selected: new Set(),
    search: '',
    risk: '',
    page: 1,
    maskedPreview: false,
    lastDeletedId: null,
    deleteTargetId: null,
    drawerRecordId: null,
    drawerReturnFocus: null,
    documentPreviewRecordId: null,
    documentPreviewKind: null,
    rawCopyKind: null,
    logs: [],
    recordStorageAvailable: true,
    sessionStorageAvailable: true,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const dialogReturnFocus = new WeakMap();

  function pad(value, length = 2) {
    return String(value).padStart(length, '0');
  }

  function updateStorageMode() {
    const badge = $('#storageMode');
    if (!badge) return;
    const recordMemoryOnly = !state.recordStorageAvailable;
    const logMemoryOnly = !state.sessionStorageAvailable;
    badge.hidden = !recordMemoryOnly && !logMemoryOnly;
    badge.textContent = recordMemoryOnly
      ? '内存模式 · 刷新会丢失'
      : '日志内存模式 · 刷新会丢失';
  }

  function chinaIdChecksum(body) {
    const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    const checkCodes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
    const sum = body.split('').reduce((total, digit, index) => total + (Number(digit) * weights[index]), 0);
    return checkCodes[sum % 11];
  }

  function luhnValid(value) {
    const digits = String(value).replace(/\D/g, '');
    if (digits.length < 12 || digits.length > 19) return false;
    let sum = 0;
    let double = false;
    for (let index = digits.length - 1; index >= 0; index -= 1) {
      let digit = Number(digits[index]);
      if (double) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      double = !double;
    }
    return sum % 10 === 0;
  }

  function ibanRemainder(value) {
    const normalized = String(value).replace(/\s/g, '').toUpperCase();
    const rearranged = `${normalized.slice(4)}${normalized.slice(0, 4)}`;
    let remainder = 0;
    for (const character of rearranged) {
      const expanded = /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character;
      for (const digit of expanded) remainder = ((remainder * 10) + Number(digit)) % 97;
    }
    return remainder;
  }

  function makeIban(countryCode, bban) {
    const provisional = `${countryCode}00${bban}`;
    return `${countryCode}${pad(98 - ibanRemainder(provisional), 2)}${bban}`;
  }

  function ibanValid(value) {
    const normalized = String(value).replace(/\s/g, '').toUpperCase();
    const lengths = { AE: 23, BR: 29, DE: 22, FR: 27, GB: 22, TR: 26 };
    return /^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(normalized)
      && lengths[normalized.slice(0, 2)] === normalized.length
      && ibanRemainder(normalized) === 1;
  }

  function bicValid(value) {
    return /^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(String(value));
  }

  function mrzCheckDigit(value) {
    const weights = [7, 3, 1];
    const characterValue = (character) => {
      if (/\d/.test(character)) return Number(character);
      if (/[A-Z]/.test(character)) return character.charCodeAt(0) - 55;
      return 0;
    };
    const total = String(value).split('').reduce((sum, character, index) => sum + (characterValue(character) * weights[index % 3]), 0);
    return String(total % 10);
  }

  function mrzDate(value) {
    return String(value).replaceAll('-', '').slice(2);
  }

  function makePassportMrz(record) {
    const nameField = `${record.surname.replaceAll(' ', '<')}<<${record.givenNames.replaceAll(' ', '<')}`.toUpperCase();
    const line1 = `P<${record.passportCountryCode}${nameField}`.padEnd(44, '<').slice(0, 44);
    const passportField = record.passport.padEnd(9, '<').slice(0, 9);
    const birthField = mrzDate(record.dateOfBirth);
    const expiryField = mrzDate(record.passportExpiry);
    const optionalField = `MOCK${record.customerId.replace(/\D/g, '')}`.padEnd(14, '<').slice(0, 14);
    const documentBlock = `${passportField}${mrzCheckDigit(passportField)}`;
    const birthBlock = `${birthField}${mrzCheckDigit(birthField)}`;
    const expiryBlock = `${expiryField}${mrzCheckDigit(expiryField)}`;
    const optionalBlock = `${optionalField}${mrzCheckDigit(optionalField)}`;
    const composite = mrzCheckDigit(`${documentBlock}${birthBlock}${expiryBlock}${optionalBlock}`);
    return {
      line1,
      line2: `${documentBlock}${record.passportCountryCode}${birthBlock}${record.sex}${expiryBlock}${optionalBlock}${composite}`,
    };
  }

  function passportMrzValid(line1, line2) {
    if (String(line1).length !== 44 || String(line2).length !== 44) return false;
    const value = String(line2);
    const documentBlock = value.slice(0, 10);
    const birthBlock = value.slice(13, 20);
    const expiryBlock = value.slice(21, 28);
    const optionalBlock = value.slice(28, 43);
    return mrzCheckDigit(documentBlock.slice(0, 9)) === documentBlock[9]
      && mrzCheckDigit(birthBlock.slice(0, 6)) === birthBlock[6]
      && mrzCheckDigit(expiryBlock.slice(0, 6)) === expiryBlock[6]
      && mrzCheckDigit(optionalBlock.slice(0, 14)) === optionalBlock[14]
      && mrzCheckDigit(`${documentBlock}${birthBlock}${expiryBlock}${optionalBlock}`) === value[43];
  }

  function makeTckn(seed) {
    const firstNine = String(100000000 + seed).slice(0, 9);
    const digits = firstNine.split('').map(Number);
    const odd = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
    const even = digits[1] + digits[3] + digits[5] + digits[7];
    const tenth = (((odd * 7) - even) % 10 + 10) % 10;
    const eleventh = (digits.reduce((sum, digit) => sum + digit, 0) + tenth) % 10;
    return `${firstNine}${tenth}${eleventh}`;
  }

  function makeFrenchNir(sequence, dateOfBirth, sex) {
    const compactDate = dateOfBirth.replaceAll('-', '');
    const body = `${sex === 'F' ? '2' : '1'}${compactDate.slice(2, 6)}99${pad(900 + sequence, 3)}${pad(100 + sequence, 3)}`;
    const key = pad(97 - Number(BigInt(body) % 97n), 2);
    return `${body.slice(0, 1)} ${body.slice(1, 3)} ${body.slice(3, 5)} ${body.slice(5, 7)} ${body.slice(7, 10)} ${body.slice(10)} ${key}`;
  }

  function makeNric(sequence) {
    const digits = pad(sequence, 7);
    const weights = [2, 7, 6, 5, 4, 3, 2];
    const sum = digits.split('').reduce((total, digit, index) => total + (Number(digit) * weights[index]), 4);
    return `T${digits}${'JZIHGFEDC'[sum % 11]}`;
  }

  function verhoeffCheckDigit(value) {
    const d = [
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
      [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
      [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
      [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
      [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
    ];
    const p = [
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
      [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
      [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
      [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
    ];
    const inverse = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];
    let checksum = 0;
    String(value).split('').reverse().forEach((digit, index) => {
      checksum = d[checksum][p[(index + 1) % 8][Number(digit)]];
    });
    return inverse[checksum];
  }

  function makeAadhaar(sequence) {
    const firstEleven = `9999999900${sequence}`;
    const raw = `${firstEleven}${verhoeffCheckDigit(firstEleven)}`;
    return `${raw.slice(0, 4)} ${raw.slice(4, 8)} ${raw.slice(8)}`;
  }

  function aadhaarValid(value) {
    const raw = String(value).replace(/\D/g, '');
    return raw.length === 12 && verhoeffCheckDigit(raw.slice(0, 11)) === Number(raw[11]);
  }

  function makeMyNumber(sequence) {
    const firstEleven = `1234567890${sequence}`;
    const total = firstEleven.split('').reverse().reduce((sum, digit, index) => {
      const weight = index < 6 ? index + 2 : index - 5;
      return sum + (Number(digit) * weight);
    }, 0);
    const candidate = 11 - (total % 11);
    const raw = `${firstEleven}${candidate >= 10 ? 0 : candidate}`;
    return `${raw.slice(0, 4)} ${raw.slice(4, 8)} ${raw.slice(8)}`;
  }

  function myNumberValid(value) {
    const raw = String(value).replace(/\D/g, '');
    if (raw.length !== 12) return false;
    const total = raw.slice(0, 11).split('').reverse().reduce((sum, digit, index) => {
      const weight = index < 6 ? index + 2 : index - 5;
      return sum + (Number(digit) * weight);
    }, 0);
    const candidate = 11 - (total % 11);
    return Number(raw[11]) === (candidate >= 10 ? 0 : candidate);
  }

  function makeClabe(sequence) {
    const firstSeventeen = `002180${pad(10000000000 + sequence, 11)}`;
    const weights = [3, 7, 1];
    const sum = firstSeventeen.split('').reduce((total, digit, index) => total + ((Number(digit) * weights[index % 3]) % 10), 0);
    return `${firstSeventeen}${(10 - (sum % 10)) % 10}`;
  }

  function clabeValid(value) {
    const raw = String(value).replace(/\D/g, '');
    if (raw.length !== 18) return false;
    const weights = [3, 7, 1];
    const sum = raw.slice(0, 17).split('').reduce((total, digit, index) => total + ((Number(digit) * weights[index % 3]) % 10), 0);
    return Number(raw[17]) === (10 - (sum % 10)) % 10;
  }

  function makeCpf(sequence) {
    const firstNine = `3905334${pad(10 + sequence, 2)}`;
    const calculate = (digits, startWeight) => {
      const total = digits.split('').reduce((sum, digit, index) => sum + (Number(digit) * (startWeight - index)), 0);
      const result = 11 - (total % 11);
      return result >= 10 ? 0 : result;
    };
    const first = calculate(firstNine, 10);
    const second = calculate(`${firstNine}${first}`, 11);
    const raw = `${firstNine}${first}${second}`;
    return `${raw.slice(0, 3)}.${raw.slice(3, 6)}.${raw.slice(6, 9)}-${raw.slice(9)}`;
  }

  function luhnCheckDigit(firstDigits) {
    for (let candidate = 0; candidate <= 9; candidate += 1) {
      if (luhnValid(`${firstDigits}${candidate}`)) return candidate;
    }
    return 0;
  }

  function makeSin(sequence) {
    const firstEight = `0464542${sequence}`;
    const raw = `${firstEight}${luhnCheckDigit(firstEight)}`;
    return `${raw.slice(0, 3)} ${raw.slice(3, 6)} ${raw.slice(6)}`;
  }

  function makeTfn(sequence) {
    const firstEight = `1234567${sequence}`;
    const weights = [1, 4, 3, 7, 5, 8, 6, 9, 10];
    for (let candidate = 0; candidate <= 9; candidate += 1) {
      const raw = `${firstEight}${candidate}`;
      const total = raw.split('').reduce((sum, digit, index) => sum + (Number(digit) * weights[index]), 0);
      if (total % 11 === 0) return `${raw.slice(0, 3)} ${raw.slice(3, 6)} ${raw.slice(6)}`;
    }
    return '123 456 782';
  }

  function makeKoreanRrn(sequence, dateOfBirth, sex) {
    const compactDate = dateOfBirth.replaceAll('-', '');
    const year = Number(compactDate.slice(0, 4));
    const genderCode = year >= 2000 ? (sex === 'F' ? '4' : '3') : (sex === 'F' ? '2' : '1');
    const firstTwelve = `${compactDate.slice(2)}${genderCode}${pad(sequence, 5)}`;
    const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
    const total = firstTwelve.split('').reduce((sum, digit, index) => sum + (Number(digit) * weights[index]), 0);
    return `${firstTwelve.slice(0, 6)}-${firstTwelve.slice(6)}${(11 - (total % 11)) % 10}`;
  }

  function makeFrenchBban(sequence) {
    const bank = '20041';
    const branch = '01005';
    const account = pad(100000 + sequence, 11);
    const key = pad(97 - Number(((89n * BigInt(bank)) + (15n * BigInt(branch)) + (3n * BigInt(account))) % 97n), 2);
    return `${bank}${branch}${account}${key}`;
  }

  function createInitialRecords() {
    const profiles = [
      { country: '中国', nationality: '中国', name: '李明', latinName: 'LI MING', idType: '居民身份证', phone: (n) => `13800138${pad(n, 3)}`, id: (n, dob) => { const body = `110101${dob.replaceAll('-', '')}${pad(n, 3)}`; return `${body}${chinaIdChecksum(body)}`; }, passport: (n) => `E0000${pad(n, 4)}`, address: (n) => `北京市朝阳区建国路 ${88 + n} 号测试单元`, swift: 'BKCHCNBJ' },
      { country: '美国', nationality: '美国', name: 'Emma Carter', latinName: 'EMMA CARTER', idType: 'Social Security Number', phone: (n) => `+1 202-555-${pad(100 + n, 4)}`, id: (n) => `900-${pad(10 + n, 2)}-${pad(1000 + n, 4)}`, passport: (n) => `${pad(n, 9)}`, address: (n) => `${1200 + n} Example Avenue, Washington, DC 20001`, swift: 'BOFAUS3N' },
      { country: '英国', nationality: '英国', name: 'Oliver Smith', latinName: 'OLIVER SMITH', idType: 'National Insurance Number', phone: (n) => `+44 7700 900${pad(n, 3)}`, id: (n) => `QQ ${pad(10 + n, 2)} ${pad(20 + n, 2)} ${pad(30 + n, 2)} C`, passport: (n) => `${pad(100000000 + n, 9)}`, address: (n) => `${10 + n} Example Road, London, SW1A 1AA`, swift: 'BARCGB22' },
      { country: '德国', nationality: '德国', name: 'Lukas Weber', latinName: 'LUKAS WEBER', idType: 'Personalausweis', phone: (n) => `+49 30 0000 ${pad(n, 4)}`, id: (n) => `T2200012${n}`, passport: (n) => `C01X00${pad(n, 3)}`, address: (n) => `Musterstrasse ${10 + n}, 10115 Berlin`, swift: 'DEUTDEFF' },
      { country: '法国', nationality: '法国', name: 'Camille Martin', latinName: 'CAMILLE MARTIN', idType: 'Numéro de sécurité sociale', phone: (n) => `+33 1 99 00 00 ${pad(n, 2)}`, id: makeFrenchNir, passport: (n) => `00FR${pad(n, 5)}`, address: (n) => `${10 + n} rue Exemple, 75001 Paris`, swift: 'BNPAFRPP' },
      { country: '新加坡', nationality: '新加坡', name: 'Tan Wei Ming', latinName: 'TAN WEI MING', idType: 'NRIC', phone: (n) => `+65 8555 ${pad(100 + n, 4)}`, id: makeNric, passport: (n) => `E000${pad(n, 5)}`, address: (n) => `${10 + n} Example Walk, Singapore 018956`, swift: 'DBSSSGSG' },
      { country: '阿联酋', nationality: '阿联酋', name: 'Omar Al Mansoori', latinName: 'OMAR AL MANSOORI', idType: 'Emirates ID', phone: (n) => `+971 50 555 ${pad(100 + n, 4)}`, id: (n, dob) => `784-${dob.slice(0, 4)}-${pad(1234500 + n, 7)}-${n}`, passport: (n) => `A000${pad(n, 5)}`, address: (n) => `Villa ${10 + n}, Example District, Dubai`, swift: 'EBILAEAD' },
      { country: '土耳其', nationality: '土耳其', name: 'Ayşe Yılmaz', latinName: 'AYSE YILMAZ', idType: 'T.C. Kimlik No', phone: (n) => `+90 555 000 ${pad(100 + n, 4)}`, id: makeTckn, passport: (n) => `U00${pad(n, 6)}`, address: (n) => `Örnek Mahallesi No ${10 + n}, İstanbul`, swift: 'ISBKTRIS' },
      { country: '印度', nationality: '印度', name: 'Arjun Mehta', latinName: 'ARJUN MEHTA', idType: 'Aadhaar', phone: (n) => `+91 99999 ${pad(n, 5)}`, id: makeAadhaar, passport: (n) => `Z000${pad(n, 4)}`, address: (n) => `${10 + n} Example Nagar, New Delhi 110001`, swift: 'SBININBB' },
      { country: '日本', nationality: '日本', name: '佐藤 健', latinName: 'SATO KEN', idType: 'My Number', phone: (n) => `+81 90-0000-${pad(100 + n, 4)}`, id: makeMyNumber, passport: (n) => `TR000${pad(n, 4)}`, address: (n) => `東京都千代田区丸の内 ${n}-1 テスト棟`, swift: 'BOTKJPJT' },
      { country: '韩国', nationality: '韩国', name: '김민수', latinName: 'KIM MIN SU', idType: 'Resident Registration Number', phone: (n) => `+82 10-0000-${pad(100 + n, 4)}`, id: makeKoreanRrn, passport: (n) => `M000${pad(n, 5)}`, address: (n) => `서울특별시 중구 세종대로 ${100 + n} 테스트동`, swift: 'HVBKKRSE' },
      { country: '巴西', nationality: '巴西', name: 'Ana Souza', latinName: 'ANA SOUZA', idType: 'CPF', phone: (n) => `+55 11 90000-${pad(100 + n, 4)}`, id: makeCpf, passport: (n) => `BR00${pad(n, 4)}`, address: (n) => `Rua Exemplo ${10 + n}, São Paulo - SP, 01000-000`, swift: 'BRASBRRJ' },
      { country: '墨西哥', nationality: '墨西哥', name: 'Maria Gonzalez', latinName: 'MARIA GONZALEZ', idType: 'CURP', phone: (n) => `+52 55 0000 ${pad(n, 4)}`, id: () => 'GODE561231HDFRRN09', passport: (n) => `G00${pad(n, 6)}`, address: (n) => `Avenida Ejemplo ${10 + n}, Ciudad de Mexico`, swift: 'BCMRMXMM' },
      { country: '加拿大', nationality: '加拿大', name: 'Emily Tremblay', latinName: 'EMILY TREMBLAY', idType: 'Social Insurance Number', phone: (n) => `+1 613-555-${pad(100 + n, 4)}`, id: makeSin, passport: (n) => `AB00${pad(n, 4)}`, address: (n) => `${10 + n} Example Street, Ottawa, ON K1A 0B1`, swift: 'ROYCCAT2' },
      { country: '澳大利亚', nationality: '澳大利亚', name: 'Jack Wilson', latinName: 'JACK WILSON', idType: 'Tax File Number', phone: (n) => `+61 491 570 ${pad(100 + n, 3)}`, id: makeTfn, passport: (n) => `N00${pad(n, 6)}`, address: (n) => `${10 + n} Example Circuit, Canberra ACT 2600`, swift: 'CTBAAU2S' },
      { country: '巴拿马', nationality: '巴拿马', name: 'Carlos Rodríguez', latinName: 'CARLOS RODRIGUEZ', idType: 'Cédula', phone: (n) => `+507 6000-${pad(100 + n, 4)}`, id: (n) => `8-888-${pad(8800 + n, 4)}`, passport: (n) => `PA00${pad(n, 4)}`, address: (n) => `Calle Ejemplo ${10 + n}, Ciudad de Panamá`, swift: 'NAPAPAPA' },
    ];
    const occupations = ['Security Analyst', 'Compliance Officer', 'Product Manager', 'Financial Analyst', 'Procurement Specialist', 'Designer', 'Operations Manager', 'Data Analyst'];
    const risks = ['低', '低', '中', '低', '高', '中', '低', '中'];
    const bankProfiles = [
      { countryCode: 'CN', passportCode: 'CHN', brand: 'UnionPay', funding: 'Debit', pan: '6200000000000005', currency: 'CNY', codeType: 'CNAPS', code: '102100099996', account: (n) => pad(6222020000000000 + n, 16), bic: 'MCKBCNB0XXX' },
      { countryCode: 'US', passportCode: 'USA', brand: 'American Express', funding: 'Credit', pan: '378282246310005', currency: 'USD', codeType: 'ABA routing', code: '110000000', account: (n) => pad(9000000000 + n, 10), bic: 'MCKBUSN0XXX' },
      { countryCode: 'GB', passportCode: 'GBR', brand: 'Mastercard', funding: 'Credit', pan: '5555555555554444', currency: 'GBP', codeType: 'Sort code', code: '20-00-00', account: (n) => pad(10000000 + n, 8), bban: (n) => `MCKB200000${pad(10000000 + n, 8)}`, bic: 'MCKBGBL0XXX' },
      { countryCode: 'DE', passportCode: 'DEU', brand: 'Visa Debit', funding: 'Debit', pan: '4000056655665556', currency: 'EUR', codeType: 'BLZ', code: '10000000', account: (n) => pad(1000000000 + n, 10), bban: (n) => `10000000${pad(1000000000 + n, 10)}`, bic: 'MCKBDEF0XXX' },
      { countryCode: 'FR', passportCode: 'FRA', brand: 'Cartes Bancaires / Visa', funding: 'Debit', pan: '4000002500001001', currency: 'EUR', codeType: 'Code banque / guichet', code: '20041 / 01005', account: (n) => pad(100000 + n, 11), bban: makeFrenchBban, bic: 'MCKBFRP0XXX' },
      { countryCode: 'SG', passportCode: 'SGP', brand: 'Visa', funding: 'Credit', pan: '4242424242424242', currency: 'SGD', codeType: 'Bank / branch code', code: '7171-001', account: (n) => pad(1000000000 + n, 10), bic: 'MCKBSGS0XXX' },
      { countryCode: 'AE', passportCode: 'ARE', brand: 'Mastercard Debit', funding: 'Debit', pan: '5200828282828210', currency: 'AED', codeType: 'UAE bank code', code: '033', account: (n) => pad(1234567890123000 + n, 16), bban: (n) => `033${pad(1234567890123000 + n, 16)}`, bic: 'MCKBAED0XXX' },
      { countryCode: 'TR', passportCode: 'TUR', brand: 'Mastercard 2-series', funding: 'Credit', pan: '2223003122003222', currency: 'TRY', codeType: 'Bank code', code: '00061', account: (n) => pad(1000000000000000 + n, 16), bban: (n) => `000610${pad(1000000000000000 + n, 16)}`, bic: 'MCKBTRI0XXX' },
      { countryCode: 'IN', passportCode: 'IND', brand: 'Visa Debit', funding: 'Debit', pan: '4000056655665556', currency: 'INR', codeType: 'IFSC', code: 'MCKB0000001', account: (n) => pad(100000000000 + n, 12), bic: 'MCKBINM0XXX' },
      { countryCode: 'JP', passportCode: 'JPN', brand: 'JCB', funding: 'Credit', pan: '3566002020360505', currency: 'JPY', codeType: 'Zengin bank / branch', code: '0005-001', account: (n) => pad(1000000 + n, 7), bic: 'MCKBJPY0XXX' },
      { countryCode: 'KR', passportCode: 'KOR', brand: 'BCcard', funding: 'Credit', pan: '6555900000604105', currency: 'KRW', codeType: 'Bank / branch code', code: '088-001', account: (n) => pad(100000000000 + n, 12), bic: 'MCKBKRS0XXX' },
      { countryCode: 'BR', passportCode: 'BRA', brand: 'Visa', funding: 'Credit', pan: '4242424242424242', currency: 'BRL', codeType: 'COMPE / branch', code: '00360305 / 00001', account: (n) => pad(1000 + n, 10), bban: (n) => `0036030500001${pad(1000 + n, 10)}C1`, bic: 'MCKBBRS0XXX' },
      { countryCode: 'MX', passportCode: 'MEX', brand: 'Mastercard', funding: 'Credit', pan: '5555555555554444', currency: 'MXN', codeType: 'CLABE bank / plaza', code: '002 / 180', account: makeClabe, bic: 'MCKBMXM0XXX' },
      { countryCode: 'CA', passportCode: 'CAN', brand: 'Interac', funding: 'Debit', pan: '4506445006931933', currency: 'CAD', codeType: 'Institution / transit', code: '001 / 00001', account: (n) => pad(1000000 + n, 7), bic: 'MCKBCAT0XXX' },
      { countryCode: 'AU', passportCode: 'AUS', brand: 'eftpos Australia / Visa', funding: 'Debit', pan: '4000050360000001', currency: 'AUD', codeType: 'BSB', code: '062-000', account: (n) => pad(10000000 + n, 8), bic: 'MCKBAUS0XXX' },
      { countryCode: 'PA', passportCode: 'PAN', brand: 'Visa', funding: 'Credit', pan: '4242424242424242', currency: 'PAB', codeType: 'Bank / branch code', code: '001-0001', account: (n) => pad(1000000000 + n, 10), bic: 'MCKBPAP0XXX' },
    ];
    const surnames = ['LI', 'CARTER', 'SMITH', 'WEBER', 'MARTIN', 'TAN', 'AL MANSOORI', 'YILMAZ', 'MEHTA', 'SATO', 'KIM', 'SOUZA', 'GONZALEZ', 'TREMBLAY', 'WILSON', 'RODRIGUEZ'];
    const givenNames = ['MING', 'EMMA', 'OLIVER', 'LUKAS', 'CAMILLE', 'WEI MING', 'OMAR', 'AYSE', 'ARJUN', 'KEN', 'MIN SU', 'ANA', 'MARIA', 'EMILY', 'JACK', 'CARLOS'];
    const sexes = ['M', 'F', 'M', 'M', 'F', 'M', 'M', 'F', 'M', 'M', 'M', 'F', 'F', 'F', 'M', 'M'];
    return Array.from({ length: 48 }, (_, index) => {
      const number = index + 1;
      const profile = profiles[index % profiles.length];
      const bank = bankProfiles[index % bankProfiles.length];
      const sequence = Math.floor(index / profiles.length) + 1;
      const customerId = `MOCK-KYC-${pad(number, 3)}`;
      const dateOfBirth = profile.country === '墨西哥' ? '1956-12-31' : '1990-01-01';
      const sex = sexes[index % sexes.length];
      const record = {
        customerId,
        country: profile.country,
        nationality: profile.nationality,
        name: profile.name,
        latinName: profile.latinName,
        surname: surnames[index % surnames.length],
        givenNames: givenNames[index % givenNames.length],
        sex,
        dateOfBirth,
        risk: risks[index % risks.length],
        idType: profile.idType,
        idCard: profile.id(sequence, dateOfBirth, sex),
        passport: profile.passport(sequence),
        passportCountryCode: bank.passportCode,
        passportExpiry: `203${sequence}-12-31`,
        phone: profile.phone(sequence),
        email: `${profile.latinName.toLowerCase().replaceAll(' ', '.')}.${sequence}@example.com`,
        bankName: `Mock International Bank — ${profile.country} Test Branch`,
        bankCountryCode: bank.countryCode,
        cardBrand: bank.brand,
        cardFunding: bank.funding,
        bankCard: bank.pan,
        cardExpiry: `12/${32 + sequence}`,
        cardCvc: bank.brand === 'American Express' ? '1234' : '123',
        currency: bank.currency,
        bankCodeType: bank.codeType,
        bankCode: bank.code,
        bankAccount: bank.account(sequence),
        iban: bank.bban ? makeIban(bank.countryCode, bank.bban(sequence)) : 'N/A (NON-IBAN COUNTRY)',
        swift: bank.bic,
        address: profile.address(sequence),
        company: `${profile.country} Example Holdings ${sequence}`,
        occupation: occupations[index % occupations.length],
        createdAt: `2026-07-${pad((index % 20) + 1)}T09:${pad(index % 60)}:00+08:00`,
        updatedAt: `2026-07-${pad((index % 20) + 1)}T09:${pad(index % 60)}:00+08:00`,
        deletedAt: null,
        mock: true,
        source: 'builtin-mock',
        schemaVersion: 5,
      };
      const mrz = makePassportMrz(record);
      record.passportMrz1 = mrz.line1;
      record.passportMrz2 = mrz.line2;
      return record;
    });
  }

  function validStoredRecords(value) {
    return Array.isArray(value) && value.every((item) => item
      && typeof item.customerId === 'string'
      && item.schemaVersion === 5
      && ['builtin-mock', 'user-confirmed-test'].includes(item.source));
  }

  function loadRecords() {
    let stored;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      state.records = createInitialRecords();
      state.recordStorageAvailable = false;
      updateStorageMode();
      return;
    }
    if (stored === null) {
      state.records = createInitialRecords();
      saveRecords();
      return;
    }
    try {
      const parsed = JSON.parse(stored);
      state.records = validStoredRecords(parsed) ? parsed : createInitialRecords();
      if (!validStoredRecords(parsed)) saveRecords();
    } catch {
      state.records = createInitialRecords();
      saveRecords();
    }
  }

  function saveRecords() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
      state.recordStorageAvailable = true;
      updateStorageMode();
      return true;
    } catch {
      state.recordStorageAvailable = false;
      updateStorageMode();
      return false;
    }
  }

  function loadLogs() {
    let stored;
    try {
      stored = sessionStorage.getItem(SESSION_LOG_KEY) || '[]';
    } catch {
      state.logs = [];
      state.sessionStorageAvailable = false;
      updateStorageMode();
      return;
    }
    try {
      const parsed = JSON.parse(stored);
      state.logs = Array.isArray(parsed) ? parsed.slice(0, 200) : [];
    } catch {
      state.logs = [];
    }
  }

  function addLog(action, result = '完成') {
    const entry = {
      timestamp: new Date().toISOString(),
      action: String(action).slice(0, 80),
      result: String(result).slice(0, 40),
    };
    state.logs.unshift(entry);
    state.logs = state.logs.slice(0, 200);
    try {
      sessionStorage.setItem(SESSION_LOG_KEY, JSON.stringify(state.logs));
      state.sessionStorageAvailable = true;
    } catch {
      state.sessionStorageAvailable = false;
    }
    updateStorageMode();
    renderLogs();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function xmlEscape(value) {
    return escapeHtml(value);
  }

  function csvCell(value) {
    const text = String(value ?? '');
    const safeText = /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safeText.replaceAll('"', '""')}"`;
  }

  function maskValue(field, value) {
    const text = String(value ?? '');
    if (!text) return '';
    if (field === 'name') return `${text.slice(0, 1)}${'*'.repeat(Math.max(2, text.length - 1))}`;
    if (field === 'email') {
      const [local, domain = ''] = text.split('@');
      return `${local.slice(0, 2)}***@${domain}`;
    }
    if (field === 'address') return `${text.slice(0, 6)}********（MOCK）`;
    if (field === 'phone') return `${text.slice(0, 3)}****${text.slice(-4)}`;
    if (field === 'idCard') return `${text.slice(0, 6)}********${text.slice(-4)}`;
    if (field === 'passport') return `${text.slice(0, 2)}****${text.slice(-3)}`;
    if (field === 'bankCard') return `${text.slice(0, 4)} **** **** ${text.slice(-4)}`;
    if (field === 'bankAccount') return `${text.slice(0, 3)}******${text.slice(-3)}`;
    if (field === 'cardCvc') return '*'.repeat(text.length);
    if (field === 'iban') return `${text.slice(0, 4)} **** **** ${text.slice(-4)}`;
    if (field === 'swift') return `${text.slice(0, 4)}***${text.slice(-2)}`;
    return text.length > 6 ? `${text.slice(0, 2)}***${text.slice(-2)}` : '***';
  }

  function presentRecord(record, masked = false) {
    return Object.fromEntries(EXPORT_FIELDS.map((field) => [field, masked && MASKED_FIELDS.includes(field) ? maskValue(field, record[field]) : record[field]]));
  }

  function recordNature(record) {
    return record.source === 'builtin-mock' ? 'BUILT-IN MOCK' : 'USER-CONFIRMED TEST DATA / CONTENT NOT VERIFIED';
  }

  function activeRecords() {
    return state.records.filter((record) => !record.deletedAt);
  }

  function filteredRecords() {
    const term = state.search.trim().toLowerCase();
    return activeRecords().filter((record) => {
      const searchMatch = !term || [
        record.customerId,
        record.country,
        record.nationality,
        record.name,
        record.latinName,
        record.idType,
        record.idCard,
        record.passport,
        record.phone,
        record.email,
        record.bankName,
        record.cardBrand,
        record.bankCard,
        record.bankCodeType,
        record.bankCode,
        record.bankAccount,
        record.currency,
        record.iban,
        record.swift,
        record.address,
        record.company,
      ]
        .some((value) => String(value).toLowerCase().includes(term));
      const riskMatch = !state.risk || record.risk === state.risk;
      return searchMatch && riskMatch;
    });
  }

  function pageRecords() {
    const records = filteredRecords();
    const start = (state.page - 1) * PAGE_SIZE;
    return records.slice(start, start + PAGE_SIZE);
  }

  function isRevealed() {
    return !state.maskedPreview;
  }

  function riskClass(risk) {
    return risk === '高' ? 'risk-high' : risk === '中' ? 'risk-medium' : 'risk-low';
  }

  function renderTable() {
    const rows = pageRecords();
    const reveal = isRevealed();
    $('#customerRows').innerHTML = rows.map((record) => `
      <tr>
        <td><input class="row-select" type="checkbox" data-id="${escapeHtml(record.customerId)}" aria-label="选择 ${escapeHtml(record.name)}" ${state.selected.has(record.customerId) ? 'checked' : ''}></td>
        <td class="mono">${escapeHtml(record.customerId)}</td>
        <td><span class="customer-name"><strong>${escapeHtml(record.name)}</strong><span>${escapeHtml(record.latinName || '')}</span></span></td>
        <td><strong>${escapeHtml(record.country || '自定义')}</strong><br><span class="section-help">${escapeHtml(record.idType || '身份标识')}</span></td>
        <td><span class="risk ${riskClass(record.risk)}">${escapeHtml(record.risk)}风险</span></td>
        <td class="mono">${escapeHtml(reveal ? record.idCard : maskValue('idCard', record.idCard))}</td>
        <td class="mono">${escapeHtml(reveal ? record.phone : maskValue('phone', record.phone))}</td>
        <td class="mono">${escapeHtml(reveal ? record.bankCard : maskValue('bankCard', record.bankCard))}<br><span class="section-help">${escapeHtml(record.cardBrand || '自定义卡组织')} · ${luhnValid(record.bankCard) ? 'Luhn ✓' : 'Luhn 未通过'}</span></td>
        <td><strong>${escapeHtml(record.company)}</strong><br><span class="section-help">${escapeHtml(record.occupation)}</span></td>
        <td class="row-actions">
          <button class="text-action view-record" data-id="${escapeHtml(record.customerId)}" type="button">查看</button>
          <button class="text-action edit-record" data-id="${escapeHtml(record.customerId)}" type="button">编辑</button>
          <button class="text-action danger delete-record" data-id="${escapeHtml(record.customerId)}" type="button">删除</button>
        </td>
      </tr>
    `).join('');

    const count = filteredRecords().length;
    const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    $('#emptyState').hidden = rows.length !== 0;
    $('.table-scroll').hidden = rows.length === 0;
    $('#resultCount').textContent = `共 ${count} 条（内置数据均为 MOCK）`;
    $('#pageStatus').textContent = `第 ${state.page} / ${totalPages} 页`;
    $('#prevPage').disabled = state.page <= 1;
    $('#nextPage').disabled = state.page >= totalPages;

    const pageIds = rows.map((record) => record.customerId);
    const selectedOnPage = pageIds.filter((id) => state.selected.has(id)).length;
    const selectPage = $('#selectPage');
    selectPage.checked = pageIds.length > 0 && selectedOnPage === pageIds.length;
    selectPage.indeterminate = selectedOnPage > 0 && selectedOnPage < pageIds.length;
    updateSelectionSummary();
  }

  function updateSelectionSummary() {
    const activeIds = new Set(activeRecords().map((record) => record.customerId));
    state.selected.forEach((id) => { if (!activeIds.has(id)) state.selected.delete(id); });
    const count = state.selected.size;
    $('#selectionSummary').textContent = `已选 ${count} 条`;
    $('#exportSelectionCount').textContent = String(count);
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => { toast.hidden = true; }, 3200);
  }

  function switchView(viewName, updateHash = true) {
    $$('.nav-item').forEach((button) => button.classList.toggle('is-active', button.dataset.view === viewName));
    $$('[data-view-panel]').forEach((panel) => {
      const active = panel.dataset.viewPanel === viewName;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });
    $('#sidebar').classList.remove('is-open');
    $('#mobileMenu').setAttribute('aria-expanded', 'false');
    if (viewName === 'manual') renderLogs();
    if (updateHash && window.location.hash.slice(1) !== viewName) window.location.hash = viewName;
    $('#main-content').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function customerById(id) {
    return state.records.find((record) => record.customerId === id);
  }

  function focusableElements(root) {
    return $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', root)
      .filter((element) => !element.hidden && element.getClientRects().length > 0);
  }

  function trapFocus(event, root) {
    if (event.key !== 'Tab') return;
    const focusable = focusableElements(root);
    if (!focusable.length) {
      event.preventDefault();
      root.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function showDialog(dialog, initialFocusSelector) {
    dialogReturnFocus.set(dialog, document.activeElement);
    dialog.showModal();
    window.setTimeout(() => {
      const target = initialFocusSelector ? $(initialFocusSelector, dialog) : focusableElements(dialog)[0];
      (target || dialog).focus();
    }, 0);
  }

  function closeDialog(dialog) {
    if (dialog.open) dialog.close();
  }

  function restoreDialogFocus(dialog) {
    const target = dialogReturnFocus.get(dialog);
    dialogReturnFocus.delete(dialog);
    if (target?.isConnected) target.focus();
  }

  function openDrawer(id) {
    const record = customerById(id);
    if (!record) return;
    if (!$('#detailDrawer').classList.contains('is-open')) state.drawerReturnFocus = document.activeElement;
    state.drawerRecordId = id;
    const reveal = isRevealed();
    const sensitive = (field) => escapeHtml(reveal ? record[field] : maskValue(field, record[field]));
    const ibanStatus = record.iban === 'N/A (NON-IBAN COUNTRY)' ? '该国家不采用 IBAN' : (ibanValid(record.iban) ? 'MOD-97 ✓' : 'MOD-97 未通过');
    $('#drawerContent').innerHTML = `
      <div class="summary-box"><strong>${record.source === 'builtin-mock' ? '高拟真合成 MOCK 数据' : '用户确认的本机测试数据'} / 无后端</strong><br>${record.source === 'builtin-mock' ? '完整字段用于企业浏览器 DLP、OCR、复制和下载识别；不来源于真实 KYC，禁止联系、支付或核验。' : '此档案来自用户输入，页面不验证其真实性；录入者已确认只使用获批测试信息。'}</div>
      <div class="button-row"><button class="btn btn-secondary" id="drawerReveal" type="button">${reveal ? '切换为脱敏预览' : '恢复完整明文数据'}</button><button class="btn btn-secondary copy-record" data-id="${escapeHtml(id)}" type="button">复制完整组合 KYC</button></div>
      <section class="detail-section"><h3>基本信息</h3><dl class="detail-grid"><dt>客户编号</dt><dd>${escapeHtml(record.customerId)}</dd><dt>国家 / 地区</dt><dd>${escapeHtml(record.country || '自定义')}</dd><dt>姓名</dt><dd>${escapeHtml(record.name)}</dd><dt>拉丁姓名</dt><dd>${escapeHtml(record.latinName || '')}</dd><dt>出生日期</dt><dd>${sensitive('dateOfBirth')}</dd><dt>风险等级</dt><dd><span class="risk ${riskClass(record.risk)}">${escapeHtml(record.risk)}风险</span></dd><dt>公司</dt><dd>${escapeHtml(record.company)}</dd><dt>职业</dt><dd>${escapeHtml(record.occupation)}</dd></dl></section>
      <section class="detail-section"><h3>身份与联系方式</h3><dl class="detail-grid"><dt>证件类型</dt><dd>${escapeHtml(record.idType || '身份标识')}</dd><dt>证件号码</dt><dd class="mono">${sensitive('idCard')}</dd><dt>护照号码</dt><dd class="mono">${sensitive('passport')}</dd><dt>护照有效期</dt><dd class="mono">${escapeHtml(record.passportExpiry || '')}</dd><dt>MRZ 校验</dt><dd>${record.passportMrz1 && passportMrzValid(record.passportMrz1, record.passportMrz2) ? 'ICAO 9303 校验位 ✓' : '自定义记录未校验'}</dd><dt>手机号</dt><dd class="mono">${sensitive('phone')}</dd><dt>邮箱</dt><dd>${sensitive('email')}</dd><dt>地址</dt><dd>${sensitive('address')}</dd></dl></section>
      <section class="detail-section"><h3>银行卡与账户</h3><dl class="detail-grid"><dt>持卡人</dt><dd>${sensitive('latinName')}</dd><dt>卡组织 / 类型</dt><dd>${escapeHtml(record.cardBrand || '自定义')} · ${escapeHtml(record.cardFunding || '未指定')}</dd><dt>银行卡 PAN</dt><dd class="mono">${sensitive('bankCard')} · ${luhnValid(record.bankCard) ? 'Luhn ✓' : 'Luhn 未通过'}</dd><dt>有效期 / CVC</dt><dd class="mono">${sensitive('cardExpiry')} / ${sensitive('cardCvc')} <span class="section-help">仅公开沙箱测试值；生产系统禁止留存 CVC</span></dd><dt>银行</dt><dd>${escapeHtml(record.bankName || '自定义测试银行')}</dd><dt>币种</dt><dd class="mono">${escapeHtml(record.currency || '')}</dd><dt>${escapeHtml(record.bankCodeType || '本地银行代码')}</dt><dd class="mono">${escapeHtml(record.bankCode || '')}</dd><dt>本地账户号</dt><dd class="mono">${sensitive('bankAccount')}</dd><dt>IBAN</dt><dd class="mono">${sensitive('iban')} · ${ibanStatus}</dd><dt>SWIFT / BIC</dt><dd class="mono">${sensitive('swift')} · ${bicValid(record.swift) ? 'ISO 9362 格式 ✓' : '格式未通过'}</dd></dl></section>
      <section class="detail-section"><h3>MOCK 证件图片（OCR 测试）</h3><div class="document-preview-grid"><figure><button class="document-preview-button" data-document-open="id" type="button" aria-label="打开 ${escapeHtml(record.country)} ${escapeHtml(record.idType)} MOCK 证件大图"><canvas id="drawerIdCanvas" data-document-canvas="id" width="1000" height="630" aria-label="完整 MOCK 身份证件图片"></canvas><span class="document-preview-zoom" aria-hidden="true">点击放大</span></button><figcaption>${escapeHtml(record.country)} ${escapeHtml(record.idType)} · Canvas 动态渲染</figcaption></figure><figure><button class="document-preview-button" data-document-open="passport" type="button" aria-label="打开 ${escapeHtml(record.country)} MOCK 护照大图"><canvas id="drawerPassportCanvas" data-document-canvas="passport" width="1000" height="630" aria-label="完整 MOCK 护照图片"></canvas><span class="document-preview-zoom" aria-hidden="true">点击放大</span></button><figcaption>${escapeHtml(record.country)} Passport · Canvas 动态渲染</figcaption></figure></div></section>
      <section class="detail-section"><h3>Canvas 与直接图片对比</h3><p class="section-help">以下两张使用完全相同的 MOCK 字段；左侧由 Canvas 绘制，右侧通过 &lt;img src&gt; 直接引用静态图片，便于对比企业浏览器的 OCR、截图与图片识别结果。</p><div class="document-preview-grid"><figure><button class="document-preview-button" data-document-open="comparison-canvas" type="button" aria-label="打开 Canvas 对比证件大图"><canvas data-document-canvas="comparison" width="1000" height="630" aria-label="Canvas 渲染的固定 MOCK 对比证件"></canvas><span class="document-preview-zoom" aria-hidden="true">点击放大</span></button><figcaption>Canvas · 固定对比字段</figcaption></figure><figure><button class="document-preview-button" data-document-open="direct-image" type="button" aria-label="打开直接引用的 MOCK 证件大图"><img src="${DIRECT_IMAGE_SRC}" alt="通过 img src 直接引用的固定 MOCK 对比证件" width="1000" height="630"><span class="document-preview-zoom" aria-hidden="true">点击放大</span></button><figcaption>&lt;img src&gt; · 静态图片直接引用</figcaption></figure></div></section>
    `;
    drawDocumentCanvas($('[data-document-canvas="id"]', $('#drawerContent')), record, 'id', !reveal);
    drawDocumentCanvas($('[data-document-canvas="passport"]', $('#drawerContent')), record, 'passport', !reveal);
    drawDocumentCanvas($('[data-document-canvas="comparison"]', $('#drawerContent')), COMPARISON_RECORD, 'id', false);
    $('#drawerScrim').hidden = false;
    $('#detailDrawer').inert = false;
    $('#detailDrawer').classList.add('is-open');
    $('#detailDrawer').setAttribute('aria-hidden', 'false');
    $('#closeDrawer').focus();
    addLog('查看 MOCK 客户详情', '完成');
  }

  function closeDrawer() {
    $('#detailDrawer').classList.remove('is-open');
    $('#detailDrawer').setAttribute('aria-hidden', 'true');
    $('#detailDrawer').inert = true;
    $('#drawerScrim').hidden = true;
    state.drawerRecordId = null;
    const target = state.drawerReturnFocus;
    state.drawerReturnFocus = null;
    if (target?.isConnected) target.focus();
  }

  function startReveal() {
    state.maskedPreview = !state.maskedPreview;
    $('#toggleReveal').textContent = state.maskedPreview ? '恢复完整明文数据' : '切换脱敏预览';
    $('#toggleReveal').setAttribute('aria-pressed', String(state.maskedPreview));
    renderTable();
    if (state.drawerRecordId) openDrawer(state.drawerRecordId);
    addLog('切换 KYC 展示模式', state.maskedPreview ? '脱敏预览' : '完整明文');
  }

  function openCustomerDialog(record = null) {
    $('#customerDialogTitle').textContent = record ? '编辑 KYC 测试记录' : '新增 KYC 测试记录';
    $('#formId').value = record?.customerId || '';
    $('#formName').value = record?.name || '';
    $('#formLatinName').value = record?.latinName || '';
    $('#formCountry').value = record?.country || '';
    $('#formNationality').value = record?.nationality || '';
    $('#formDateOfBirth').value = record?.dateOfBirth || '';
    $('#formIdType').value = record?.idType || '';
    $('#formRisk').value = record?.risk || '低';
    $('#formIdCard').value = record?.idCard || '';
    $('#formPassport').value = record?.passport || '';
    $('#formPhone').value = record?.phone || '';
    $('#formEmail').value = record?.email || '';
    $('#formBankCard').value = record?.bankCard || '';
    $('#formIban').value = record?.iban || '';
    $('#formSwift').value = record?.swift || '';
    $('#formCompany').value = record?.company || '';
    $('#formOccupation').value = record?.occupation || '';
    $('#formAddress').value = record?.address || '';
    $('#confirmMockOnly').checked = false;
    $('#saveCustomer').disabled = true;
    showDialog($('#customerDialog'), '#cancelCustomer');
  }

  function formRecord() {
    const existingId = $('#formId').value;
    const existing = existingId ? customerById(existingId) : null;
    const nextNumber = state.records.reduce((max, item) => {
      const match = item.customerId.match(/(\d+)$/);
      return Math.max(max, match ? Number(match[1]) : 0);
    }, 48) + 1;
    const now = new Date().toISOString();
    return {
      customerId: existing?.customerId || `MOCK-KYC-${pad(nextNumber, 3)}`,
      country: $('#formCountry').value.trim(),
      nationality: $('#formNationality').value.trim(),
      name: $('#formName').value.trim(),
      latinName: $('#formLatinName').value.trim(),
      surname: existing?.surname || $('#formLatinName').value.trim().split(/\s+/).at(-1) || 'MOCK',
      givenNames: existing?.givenNames || $('#formLatinName').value.trim().split(/\s+/).slice(0, -1).join(' ') || 'TEST',
      sex: existing?.sex || 'X',
      dateOfBirth: $('#formDateOfBirth').value,
      risk: $('#formRisk').value,
      idType: $('#formIdType').value.trim(),
      idCard: $('#formIdCard').value.trim(),
      passport: $('#formPassport').value.trim(),
      passportCountryCode: existing?.passportCountryCode || 'UTO',
      passportExpiry: existing?.passportExpiry || '',
      passportMrz1: '',
      passportMrz2: '',
      phone: $('#formPhone').value.trim(),
      email: $('#formEmail').value.trim(),
      bankName: existing?.bankName || 'User-confirmed mock bank',
      bankCountryCode: existing?.bankCountryCode || 'ZZ',
      cardBrand: existing?.cardBrand || 'User-specified test PAN',
      cardFunding: existing?.cardFunding || 'Unspecified',
      bankCard: $('#formBankCard').value.trim(),
      cardExpiry: existing?.cardExpiry || '',
      cardCvc: existing?.cardCvc || '',
      currency: existing?.currency || 'XXX',
      bankCodeType: existing?.bankCodeType || 'Local code',
      bankCode: existing?.bankCode || '',
      bankAccount: existing?.bankAccount || '',
      iban: $('#formIban').value.trim(),
      swift: $('#formSwift').value.trim(),
      company: $('#formCompany').value.trim(),
      occupation: $('#formOccupation').value.trim(),
      address: $('#formAddress').value.trim(),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      deletedAt: existing?.deletedAt || null,
      mock: false,
      source: 'user-confirmed-test',
      schemaVersion: 5,
    };
  }

  function saveCustomer(event) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    if (!$('#confirmMockOnly').checked) {
      showToast('请先确认只使用合成测试信息，不得录入真实个人信息');
      return;
    }
    const record = formRecord();
    const index = state.records.findIndex((item) => item.customerId === record.customerId);
    if (index >= 0) state.records[index] = { ...record };
    else state.records.push({ ...record });
    const persisted = saveRecords();
    closeDialog($('#customerDialog'));
    renderTable();
    addLog(index >= 0 ? '编辑 KYC 测试记录' : '新增 KYC 测试记录', persisted ? '保存到本机' : '仅当前会话');
    showToast(persisted
      ? (index >= 0 ? '测试记录已更新到本机' : '测试记录已新增到本机')
      : '仅当前页内存模式，刷新会丢失');
  }

  function requestDelete(id) {
    const record = customerById(id);
    if (!record) return;
    state.deleteTargetId = id;
    $('#deleteSummary').textContent = `${record.name}（${record.customerId}）将从列表隐藏，可通过“撤销删除”恢复。`;
    showDialog($('#deleteDialog'), '#cancelDelete');
  }

  function confirmDelete() {
    const record = customerById(state.deleteTargetId);
    if (!record) return;
    record.deletedAt = new Date().toISOString();
    record.updatedAt = record.deletedAt;
    state.selected.delete(record.customerId);
    state.lastDeletedId = record.customerId;
    $('#undoDelete').disabled = false;
    const persisted = saveRecords();
    state.deleteTargetId = null;
    renderTable();
    addLog('软删除 MOCK 客户', persisted ? '可撤销' : '仅当前会话可撤销');
    showToast(persisted ? '记录已软删除，可点击“撤销删除”恢复' : '记录已软删除；仅当前页内存模式，刷新会丢失');
    closeDialog($('#deleteDialog'));
  }

  function undoDelete() {
    const record = customerById(state.lastDeletedId);
    if (!record) return;
    record.deletedAt = null;
    record.updatedAt = new Date().toISOString();
    const persisted = saveRecords();
    state.lastDeletedId = null;
    $('#undoDelete').disabled = true;
    renderTable();
    addLog('撤销软删除', persisted ? '完成' : '仅当前会话');
    showToast(persisted ? 'MOCK 记录已恢复' : '记录已恢复；仅当前页内存模式，刷新会丢失');
  }

  function exportRecords() {
    const selectedRecords = activeRecords().filter((record) => state.selected.has(record.customerId));
    return selectedRecords.length ? selectedRecords : filteredRecords().slice(0, 10);
  }

  function dateStamp() {
    const date = new Date();
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
  }

  function downloadBlob(content, type, filename) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function toCsv(records, masked) {
    const header = EXPORT_FIELDS.map(csvCell).join(',');
    const rows = records.map((record) => {
      const presented = presentRecord(record, masked);
      return EXPORT_FIELDS.map((field) => csvCell(presented[field])).join(',');
    });
    return `\ufeff${[header, ...rows].join('\r\n')}`;
  }

  function toTxt(records, masked) {
    return records.map((record) => {
      const item = presentRecord(record, masked);
      return [
        `=== KYC TEST RECORD / ${recordNature(record)} ===`,
        ...EXPORT_FIELDS.map((field) => `${field}: ${item[field]}`),
      ].join('\n');
    }).join('\n\n');
  }

  function toHtml(records, masked) {
    const rows = records.map((record) => {
      const item = presentRecord(record, masked);
      return `<tr><td>${escapeHtml(recordNature(record))}</td>${EXPORT_FIELDS.map((field) => `<td>${escapeHtml(item[field])}</td>`).join('')}</tr>`;
    }).join('');
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>KYC Test Export</title><style>body{font:14px sans-serif;padding:24px}body:before{content:'TEST DATA / 内置数据均为 MOCK';display:block;color:#b42318;font-size:24px;font-weight:bold}table{border-collapse:collapse}th,td{padding:6px;border:1px solid #aaa}</style><h1>KYC Test Export</h1><p>用户输入内容未由页面验证；禁止使用真实个人信息。</p><table><thead><tr><th>dataNature</th>${EXPORT_FIELDS.map((field) => `<th>${escapeHtml(field)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></html>`;
  }

  function toXml(records, masked) {
    const rows = records.map((record) => {
      const item = presentRecord(record, masked);
      return `  <customer source="${record.source === 'builtin-mock' ? 'builtin-mock' : 'user-confirmed-test'}">\n${EXPORT_FIELDS.map((field) => `    <${field}>${xmlEscape(item[field])}</${field}>`).join('\n')}\n  </customer>`;
    }).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<kycTestExport masked="${masked}" userInputVerified="false">\n${rows}\n</kycTestExport>`;
  }

  function pdfEscape(value) {
    return String(value).replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  }

  function pdfAscii(value) {
    return String(value).replace(/[^\x20-\x7E]/g, '?');
  }

  function createPdf(records) {
    const lines = [
      'KYC HIGH-FIDELITY TEST EXPORT - SYNTHETIC MOCK DATA',
      'USER INPUT IS NOT VERIFIED - NEVER USE REAL PII',
      `Generated: ${new Date().toISOString()}`,
      `Records: ${records.length} (full test fields)`,
      '',
      ...records.slice(0, 10).flatMap((record) => {
        const item = presentRecord(record, false);
        const risk = record.risk === '高' ? 'HIGH' : record.risk === '中' ? 'MEDIUM' : 'LOW';
        return [
          `${item.country} | ${item.latinName} | ${risk} | ${item.idType}: ${item.idCard} | P: ${item.passport}`,
          `${item.cardBrand} PAN:${item.bankCard} EXP:${item.cardExpiry} CVC:${item.cardCvc} IBAN:${item.iban} BIC:${item.swift}`,
        ];
      }),
    ];
    const textOps = lines.map((line, index) => `BT /F1 ${index === 0 ? 15 : 9} Tf 48 ${790 - (index * 27)} Td (${pdfEscape(pdfAscii(line))}) Tj ET`).join('\n');
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${textOps.length} >>\nstream\n${textOps}\nendstream`,
    ];
    let pdf = '%PDF-1.4\n%KYC-TEST\n';
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => { pdf += `${pad(offset, 10)} 00000 n \n`; });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return new Blob([pdf], { type: 'application/pdf' });
  }

  function drawDocumentCanvas(canvas, record, kind = 'id', masked = false) {
    const ctx = canvas?.getContext?.('2d');
    if (!ctx) return false;
    const value = (field) => masked && MASKED_FIELDS.includes(field) ? maskValue(field, record[field]) : String(record[field] ?? '');
    const isPassport = kind === 'passport';
    ctx.fillStyle = isPassport ? '#f8f3e8' : '#f6f9fd';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = isPassport ? '#582c2c' : '#0b1728';
    ctx.fillRect(0, 0, canvas.width, 110);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText(isPassport ? `PASSPORT / ${record.country}` : `${record.country} / ${record.idType}`, 48, 66);
    ctx.strokeStyle = isPassport ? '#9b6b43' : '#155eef';
    ctx.lineWidth = 4;
    ctx.strokeRect(42, 145, 916, 410);
    ctx.fillStyle = '#d7deea';
    ctx.fillRect(72, 185, 210, 275);
    ctx.fillStyle = '#667085';
    ctx.fillRect(125, 235, 105, 105);
    ctx.fillRect(102, 350, 150, 80);
    ctx.fillStyle = '#172033';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(value('name'), 330, 215);
    ctx.font = '22px monospace';
    ctx.fillText(`NAME: ${value('latinName')}`, 330, 260);
    ctx.fillText(`DOB: ${value('dateOfBirth')}`, 330, 305);
    ctx.fillText(`${isPassport ? 'PASSPORT' : record.idType}: ${value(isPassport ? 'passport' : 'idCard')}`, 330, 350);
    ctx.fillText(`NATIONALITY: ${record.nationality}`, 330, 395);
    ctx.fillText(`PHONE: ${value('phone')}`, 330, 440);
    ctx.fillText(`CUSTOMER: ${record.customerId}`, 330, 485);
    if (isPassport) {
      ctx.font = '18px monospace';
      ctx.fillText(value('passportMrz1'), 72, 555);
      ctx.fillText(value('passportMrz2'), 72, 590);
    }
    ctx.save();
    ctx.translate(680, 510);
    ctx.rotate(-0.18);
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#b42318';
    ctx.font = 'bold 58px sans-serif';
    ctx.fillText('SYNTHETIC MOCK', -230, 0);
    ctx.restore();
    return true;
  }

  async function exportPng(record, kind = 'id') {
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 630;
    if (!drawDocumentCanvas(canvas, record, kind, false)) {
      addLog('下载完整 MOCK PNG 文件', '失败：Canvas 不可用');
      showToast('PNG 生成失败：浏览器未提供 Canvas 绘图能力');
      return false;
    }
    return new Promise((resolve) => {
      try {
        canvas.toBlob((blob) => {
          if (!blob) {
            addLog('下载完整 MOCK PNG 文件', '失败：Canvas 编码返回空结果');
            showToast('PNG 生成失败：浏览器未返回图片数据');
            resolve(false);
            return;
          }
          downloadBlob(blob, 'image/png', `KYC_MOCK_${kind === 'passport' ? 'PASSPORT' : 'ID'}_${record.country}_${record.customerId}_${dateStamp()}.png`);
          resolve(true);
        }, 'image/png');
      } catch (error) {
        addLog('下载完整 MOCK PNG 文件', `失败：${error?.name || 'Error'}`);
        showToast('PNG 生成失败：浏览器拒绝 Canvas 编码');
        resolve(false);
      }
    });
  }

  function openDocumentPreview(kind) {
    if (!['id', 'passport', 'comparison-canvas', 'direct-image'].includes(kind)) return;
    const isComparison = kind === 'comparison-canvas' || kind === 'direct-image';
    const isDirectImage = kind === 'direct-image';
    const record = isComparison ? COMPARISON_RECORD : customerById(state.drawerRecordId);
    if (!record) return;
    const isPassport = kind === 'passport';
    const revealed = isComparison || isRevealed();
    const sensitive = (field) => revealed ? String(record[field] ?? '') : maskValue(field, record[field]);
    state.documentPreviewRecordId = record.customerId;
    state.documentPreviewKind = kind;
    $('#documentPreviewTitle').textContent = isDirectImage
      ? '直接引用图片 · MOCK 大图'
      : `${record.country} ${isPassport ? 'Passport' : record.idType} · ${isComparison ? 'Canvas 对比大图' : 'MOCK 大图'}`;
    $('#documentPreviewMeta').textContent = `${sensitive('name')} · ${record.customerId} · ${sensitive(isPassport ? 'passport' : 'idCard')}`;
    $('#documentPreviewCanvas').hidden = isDirectImage;
    $('#documentPreviewImage').hidden = !isDirectImage;
    $('#downloadDocumentPreview').textContent = isDirectImage ? '下载直接引用 SVG' : '下载当前 PNG';
    if (isDirectImage) {
      $('#documentPreviewImage').src = DIRECT_IMAGE_SRC;
    } else if (!drawDocumentCanvas($('#documentPreviewCanvas'), record, isPassport ? 'passport' : 'id', !revealed)) {
      state.documentPreviewRecordId = null;
      state.documentPreviewKind = null;
      showToast('证件大图生成失败：浏览器未提供 Canvas 绘图能力');
      return;
    }
    showDialog($('#documentPreviewDialog'), '#closeDocumentPreview');
    addLog('打开 MOCK 证件大图', isDirectImage ? 'img 直接引用' : (isPassport ? '护照 Canvas' : '身份证件 Canvas'));
  }

  function closeDocumentPreview() {
    closeDialog($('#documentPreviewDialog'));
  }

  async function downloadDocumentPreview() {
    const kind = state.documentPreviewKind;
    if (!kind) return;
    if (kind === 'direct-image') {
      const link = document.createElement('a');
      link.href = DIRECT_IMAGE_SRC;
      link.download = 'KYC_MOCK_DIRECT_IMAGE_COMPARISON.svg';
      document.body.append(link);
      link.click();
      link.remove();
      addLog('下载当前 MOCK 证件大图', '直接引用 SVG');
      showToast('已触发直接引用的 MOCK SVG 图片下载');
      return;
    }
    const record = kind === 'comparison-canvas' ? COMPARISON_RECORD : customerById(state.documentPreviewRecordId);
    if (!record) return;
    const exportKind = kind === 'passport' ? 'passport' : 'id';
    if (await exportPng(record, exportKind)) {
      addLog('下载当前 MOCK 证件大图', exportKind === 'passport' ? '护照 PNG' : '身份证件 PNG');
      showToast('已触发当前 MOCK 证件 PNG 下载');
    }
  }

  async function performMaskedExport(format) {
    const records = exportRecords();
    if (!records.length) {
      showToast('没有可导出的测试记录');
      return;
    }
    const base = `KYC_MOCK_FULL_${records.length}_${dateStamp()}`;
    if (format === 'csv') downloadBlob(toCsv(records, false), 'text/csv;charset=utf-8', `${base}.csv`);
    if (format === 'json') downloadBlob(JSON.stringify({ builtInDataIsMock: true, userInputVerified: false, masked: false, records: records.map((record) => ({ source: record.source, ...presentRecord(record, false) })) }, null, 2), 'application/json', `${base}.json`);
    if (format === 'txt') downloadBlob(toTxt(records, false), 'text/plain;charset=utf-8', `${base}.txt`);
    if (format === 'html') downloadBlob(toHtml(records, false), 'text/html;charset=utf-8', `${base}.html`);
    if (format === 'xml') downloadBlob(toXml(records, false), 'application/xml;charset=utf-8', `${base}.xml`);
    if (format === 'pdf') downloadBlob(createPdf(records), 'application/pdf', `${base}.pdf`);
    if (format === 'id-png' && !await exportPng(records[0], 'id')) return;
    if (format === 'passport-png' && !await exportPng(records[0], 'passport')) return;
    addLog(`下载完整 MOCK ${format.toUpperCase()} 文件`, `记录数 ${records.length}`);
    showToast(`已触发 ${format.toUpperCase()} 完整 MOCK 测试文件下载`);
  }

  function openRawExportDialog() {
    const records = exportRecords();
    if (!records.length) {
      showToast('没有可导出的测试记录');
      return;
    }
    const userSuppliedCount = records.filter((record) => record.source !== 'builtin-mock').length;
    $('#rawExportSummary').innerHTML = `<strong>导出摘要</strong><br>格式：CSV<br>记录数：${records.length}<br>字段数：${EXPORT_FIELDS.length}<br>敏感字段：姓名、身份证、护照/MRZ、手机号、邮箱、PAN、有效期、测试 CVC、本地账户、IBAN、BIC、地址<br>内置 MOCK：${records.length - userSuppliedCount} 条<br>用户确认的测试数据：${userSuppliedCount} 条<br>页面不会验证用户输入内容的真实性。`;
    $('#rawExportConfirm').value = '';
    $('#confirmRawExport').disabled = true;
    showDialog($('#rawExportDialog'), '#cancelRawExport');
  }

  function confirmRawExport(event) {
    event.preventDefault();
    if ($('#rawExportConfirm').value !== RAW_CONFIRM_TEXT) return;
    const records = exportRecords();
    downloadBlob(toCsv(records, false), 'text/csv;charset=utf-8', `KYC_TEST_UNMASKED_HIGH_RISK_${records.length}_${dateStamp()}.csv`);
    closeDialog($('#rawExportDialog'));
    addLog('下载完整高拟真 MOCK CSV', `高风险确认，记录数 ${records.length}`);
    showToast('已触发完整高拟真 MOCK CSV 下载');
  }

  function utf8Base64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function copySourceRecord() {
    const selected = activeRecords().find((record) => state.selected.has(record.customerId));
    return selected || filteredRecords()[0] || null;
  }

  async function copyText(text, action, raw = false) {
    try {
      await navigator.clipboard.writeText(text);
      $('#copyStatus').textContent = raw
        ? `${action}：完整 MOCK 字段写入成功。测试后可单击“覆盖剪贴板”。`
        : `${action}：脱敏预览内容写入成功。`;
      addLog(action, '允许');
      showToast(raw ? '完整 MOCK 测试内容已写入剪贴板' : '脱敏预览内容已写入剪贴板');
      return true;
    } catch (error) {
      $('#copyStatus').textContent = `${action}：被浏览器拒绝或不可用`;
      addLog(action, `拒绝 ${error?.name || 'Error'}`);
      showToast('剪贴板写入被拒绝或不可用');
      return false;
    }
  }

  function copyPayload(record, kind, masked) {
    if (kind === 'idCard') return masked ? maskValue('idCard', record.idCard) : record.idCard;
    if (kind === 'kyc') return toTxt([record], masked);
    if (kind === 'json') return JSON.stringify({ builtInMock: record.source === 'builtin-mock', masked, ...presentRecord(record, masked) }, null, 2);
    return utf8Base64(JSON.stringify({ builtInMock: record.source === 'builtin-mock', masked, ...presentRecord(record, masked) }));
  }

  async function performCopy(kind, masked = false, explicitId = null) {
    const record = explicitId ? customerById(explicitId) : copySourceRecord();
    if (!record) {
      showToast('没有可用于复制的测试记录');
      return;
    }
    const labels = {
      idCard: '证件号码',
      kyc: '组合 KYC 文本',
      json: 'KYC JSON',
      base64: 'KYC Base64',
    };
    const action = `复制${masked ? '脱敏预览' : '完整 MOCK'} ${labels[kind] || '测试数据'}`;
    await copyText(copyPayload(record, kind, masked), action, !masked);
  }

  function openRawCopyDialog(kind = 'kyc') {
    const record = copySourceRecord();
    if (!record) {
      showToast('没有可用于复制的测试记录');
      return;
    }
    state.rawCopyKind = kind;
    $('#rawCopySummary').innerHTML = `<strong>复制摘要</strong><br>记录：${escapeHtml(record.customerId)}<br>内容：完整高拟真组合 KYC 文本<br>来源：${record.source === 'builtin-mock' ? '内置 MOCK' : '用户确认的测试数据'}<br>测试后可使用页面按钮覆盖剪贴板。`;
    $('#rawCopyConfirm').value = '';
    $('#confirmRawCopy').disabled = true;
    showDialog($('#rawCopyDialog'), '#cancelRawCopy');
  }

  async function confirmRawCopy(event) {
    event.preventDefault();
    if ($('#rawCopyConfirm').value !== RAW_COPY_CONFIRM_TEXT || !state.rawCopyKind) return;
    await performCopy(state.rawCopyKind, false);
    state.rawCopyKind = null;
    closeDialog($('#rawCopyDialog'));
  }

  function displayFileMetadata(fileList) {
    const files = Array.from(fileList || []);
    const container = $('#fileMetadata');
    if (!files.length) {
      container.innerHTML = '<p>尚未选择文件</p>';
      return;
    }
    container.innerHTML = `<ul>${files.map((file) => `<li><strong>${escapeHtml(file.name)}</strong> · ${escapeHtml(file.type || '未知类型')} · ${Math.ceil(file.size / 1024)} KB · 修改于 ${escapeHtml(new Date(file.lastModified).toLocaleString('zh-CN'))}</li>`).join('')}</ul><p class="section-help">只读取以上 File 元数据，没有读取文件内容，也没有网络上传。</p>`;
    addLog('选择或拖放本地文件', `仅元数据，文件数 ${files.length}`);
  }

  function setPermissionStatus(name, status) {
    const output = $(`#status-${name}`);
    if (output) output.textContent = status;
  }

  async function testNotification() {
    if (!('Notification' in window)) throw new Error('浏览器不支持 Notification API');
    const result = await Notification.requestPermission();
    setPermissionStatus('notification', result === 'granted' ? '已允许' : result === 'denied' ? '已拒绝' : '未决定');
    addLog('通知权限请求', result);
  }

  function testGeolocation() {
    if (!navigator.geolocation) {
      setPermissionStatus('geolocation', '浏览器不支持');
      addLog('位置权限请求', '不支持');
      return;
    }
    setPermissionStatus('geolocation', '等待用户决定…');
    navigator.geolocation.getCurrentPosition(
      () => {
        setPermissionStatus('geolocation', '已允许（坐标未显示、未保存）');
        addLog('位置权限请求', '允许，坐标未记录');
      },
      (error) => {
        setPermissionStatus('geolocation', '已拒绝或不可用');
        addLog('位置权限请求', `拒绝 ${error.code}`);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 },
    );
  }

  async function testMedia(kind) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('浏览器不支持媒体权限 API');
    const constraints = kind === 'camera' ? { video: true, audio: false } : { video: false, audio: true };
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      const trackCount = stream.getTracks().length;
      setPermissionStatus(kind, `已允许；${trackCount} 条媒体轨道将立即停止`);
      addLog(`${kind === 'camera' ? '摄像头' : '麦克风'}权限请求`, '允许并立即停止轨道');
    } finally {
      if (stream) stream.getTracks().forEach((track) => track.stop());
    }
  }

  function testPopup() {
    const randomPart = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const popup = window.open('', `mock-browser-test-${randomPart}`, 'width=460,height=300');
    if (!popup) {
      setPermissionStatus('popup', '被浏览器拦截');
      addLog('弹窗测试', '拦截');
      return;
    }
    popup.opener = null;
    popup.document.title = 'MOCK 弹窗测试';
    popup.document.body.textContent = 'MOCK 企业浏览器弹窗测试：无数据、无后端。此窗口可直接关闭。';
    setPermissionStatus('popup', '已允许打开同源窗口');
    addLog('弹窗测试', '允许');
  }

  async function testFullscreen() {
    if (!document.documentElement.requestFullscreen) throw new Error('浏览器不支持全屏 API');
    await document.documentElement.requestFullscreen();
    setPermissionStatus('fullscreen', '已进入全屏，按 Esc 退出');
    addLog('全屏权限请求', '允许');
  }

  async function handlePermission(name) {
    try {
      if (name === 'notification') await testNotification();
      if (name === 'geolocation') testGeolocation();
      if (name === 'camera' || name === 'microphone') await testMedia(name);
      if (name === 'clipboard') {
        await navigator.clipboard.writeText('MOCK ENTERPRISE BROWSER CLIPBOARD WRITE TEST - NO PII');
        setPermissionStatus('clipboard', '写入成功（未读取剪贴板）');
        addLog('剪贴板写入权限测试', '允许');
      }
      if (name === 'popup') testPopup();
      if (name === 'fullscreen') await testFullscreen();
    } catch (error) {
      setPermissionStatus(name, `被拒绝或不可用：${error?.name || 'Error'}`);
      addLog(`${name} 权限测试`, `拒绝 ${error?.name || 'Error'}`);
    }
  }

  function renderLogs() {
    const container = $('#activityLog');
    if (!container) return;
    if (!state.logs.length) {
      container.innerHTML = '<li>当前会话尚无测试日志</li>';
      return;
    }
    container.innerHTML = state.logs.map((entry) => `<li><time datetime="${escapeHtml(entry.timestamp)}">${escapeHtml(new Date(entry.timestamp).toLocaleString('zh-CN'))}</time> · ${escapeHtml(entry.action)} · <strong>${escapeHtml(entry.result)}</strong></li>`).join('');
  }

  function bindEvents() {
    $$('.nav-item').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
    $$('[data-view-link]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.viewLink)));
    $('#mobileMenu').addEventListener('click', () => {
      const sidebar = $('#sidebar');
      sidebar.classList.toggle('is-open');
      $('#mobileMenu').setAttribute('aria-expanded', String(sidebar.classList.contains('is-open')));
    });

    $('#filterForm').addEventListener('submit', (event) => {
      event.preventDefault();
      state.search = $('#searchInput').value;
      state.risk = $('#riskFilter').value;
      state.page = 1;
      renderTable();
      addLog('筛选 MOCK 客户', '完成');
    });
    $('#resetFilter').addEventListener('click', () => {
      $('#searchInput').value = '';
      $('#riskFilter').value = '';
      state.search = '';
      state.risk = '';
      state.page = 1;
      renderTable();
    });
    $('#prevPage').addEventListener('click', () => { state.page = Math.max(1, state.page - 1); renderTable(); });
    $('#nextPage').addEventListener('click', () => { state.page += 1; renderTable(); });
    $('#selectPage').addEventListener('change', (event) => {
      pageRecords().forEach((record) => event.target.checked ? state.selected.add(record.customerId) : state.selected.delete(record.customerId));
      renderTable();
    });
    $('#customerRows').addEventListener('change', (event) => {
      if (!event.target.matches('.row-select')) return;
      event.target.checked ? state.selected.add(event.target.dataset.id) : state.selected.delete(event.target.dataset.id);
      renderTable();
    });
    $('#customerRows').addEventListener('click', (event) => {
      const id = event.target.dataset.id;
      if (event.target.matches('.view-record')) openDrawer(id);
      if (event.target.matches('.edit-record')) openCustomerDialog(customerById(id));
      if (event.target.matches('.delete-record')) requestDelete(id);
    });

    $('#toggleReveal').addEventListener('click', startReveal);
    $('#closeDrawer').addEventListener('click', closeDrawer);
    $('#drawerScrim').addEventListener('click', closeDrawer);
    $('#drawerContent').addEventListener('click', (event) => {
      const previewButton = event.target.closest('[data-document-open]');
      if (previewButton) openDocumentPreview(previewButton.dataset.documentOpen);
      if (event.target.id === 'drawerReveal') startReveal();
      if (event.target.matches('.copy-record')) performCopy('kyc', false, event.target.dataset.id);
    });
    $('#closeDocumentPreview').addEventListener('click', closeDocumentPreview);
    $('#cancelDocumentPreview').addEventListener('click', closeDocumentPreview);
    $('#downloadDocumentPreview').addEventListener('click', downloadDocumentPreview);
    $('#documentPreviewDialog').addEventListener('close', () => {
      state.documentPreviewRecordId = null;
      state.documentPreviewKind = null;
    });
    $('#addCustomer').addEventListener('click', () => openCustomerDialog());
    $('#confirmMockOnly').addEventListener('change', (event) => { $('#saveCustomer').disabled = !event.target.checked; });
    $('#cancelCustomer').addEventListener('click', () => closeDialog($('#customerDialog')));
    $('#closeCustomer').addEventListener('click', () => closeDialog($('#customerDialog')));
    $('#customerForm').addEventListener('submit', saveCustomer);

    $('#cancelDelete').addEventListener('click', () => { state.deleteTargetId = null; closeDialog($('#deleteDialog')); });
    $('#confirmDelete').addEventListener('click', confirmDelete);
    $('#undoDelete').addEventListener('click', undoDelete);
    $('#restoreData').addEventListener('click', () => showDialog($('#resetDialog'), '#cancelReset'));
    $('#cancelReset').addEventListener('click', () => closeDialog($('#resetDialog')));
    $('#confirmReset').addEventListener('click', () => {
      state.records = createInitialRecords();
      state.selected.clear();
      state.lastDeletedId = null;
      $('#undoDelete').disabled = true;
      const persisted = saveRecords();
      state.page = 1;
      renderTable();
      addLog('恢复初始 MOCK 数据', persisted ? '48 条' : '48 条，仅当前会话');
      showToast(persisted ? '已恢复 48 条多国家初始 MOCK 数据' : '已恢复 48 条数据；仅当前页内存模式，刷新会丢失');
      closeDialog($('#resetDialog'));
    });

    $('#maskedExports').addEventListener('click', (event) => {
      const button = event.target.closest('[data-export]');
      if (button) performMaskedExport(button.dataset.export);
    });
    $('#rawExport').addEventListener('click', openRawExportDialog);
    $('#rawExportConfirm').addEventListener('input', (event) => { $('#confirmRawExport').disabled = event.target.value !== RAW_CONFIRM_TEXT; });
    $('#cancelRawExport').addEventListener('click', () => closeDialog($('#rawExportDialog')));
    $('#rawExportForm').addEventListener('submit', confirmRawExport);
    $('#downloadBlob').addEventListener('click', () => {
      downloadBlob('MOCK BLOB DOWNLOAD TEST\nNo real personal information.\n', 'text/plain;charset=utf-8', `MOCK_BLOB_DOWNLOAD_${dateStamp()}.txt`);
      addLog('普通 Blob 下载', '触发');
    });

    $$('.copy-test').forEach((button) => button.addEventListener('click', () => performCopy(button.dataset.copy, false)));
    $('#rawCopy').addEventListener('click', () => openRawCopyDialog('kyc'));
    $('#rawCopyConfirm').addEventListener('input', (event) => { $('#confirmRawCopy').disabled = event.target.value !== RAW_COPY_CONFIRM_TEXT; });
    $('#cancelRawCopy').addEventListener('click', () => { state.rawCopyKind = null; closeDialog($('#rawCopyDialog')); });
    $('#rawCopyForm').addEventListener('submit', confirmRawCopy);
    $('#clearClipboard').addEventListener('click', () => copyText('MOCK CLIPBOARD CLEARED - NO SENSITIVE TEST DATA', '覆盖剪贴板为无敏感测试文本'));
    $('#clipboardWriteTest').addEventListener('click', () => copyText('MOCK ENTERPRISE BROWSER CLIPBOARD WRITE TEST - NO PII', '无敏感文本剪贴板写入'));
    $('#pasteArea').addEventListener('input', (event) => { $('#pasteCount').textContent = `${event.target.value.length} 个字符`; });
    $('#clearPaste').addEventListener('click', () => { $('#pasteArea').value = ''; $('#pasteCount').textContent = '0 个字符'; addLog('清空手动粘贴区', '完成'); });

    $('#fileInput').addEventListener('change', (event) => displayFileMetadata(event.target.files));
    ['dragenter', 'dragover'].forEach((name) => $('#dropZone').addEventListener(name, (event) => { event.preventDefault(); $('#dropZone').classList.add('is-dragging'); }));
    ['dragleave', 'drop'].forEach((name) => $('#dropZone').addEventListener(name, (event) => { event.preventDefault(); $('#dropZone').classList.remove('is-dragging'); }));
    $('#dropZone').addEventListener('drop', (event) => displayFileMetadata(event.dataTransfer.files));
    $('#clearFiles').addEventListener('click', () => { $('#fileInput').value = ''; displayFileMetadata([]); addLog('清空文件元数据', '完成'); });
    $('#printPage').addEventListener('click', () => { addLog('打印页面测试', '触发'); window.print(); });
    $('#openWindow').addEventListener('click', testPopup);
    $('#externalLink').addEventListener('click', () => addLog('打开外部测试链接', '触发'));

    $$('.permission-test').forEach((button) => button.addEventListener('click', () => handlePermission(button.dataset.permission)));

    $('#manualChecklist').addEventListener('change', (event) => {
      if (event.target.type === 'checkbox') addLog('更新人工验证清单', event.target.checked ? '已勾选' : '取消勾选');
    });
    $('#clearLog').addEventListener('click', () => {
      state.logs = [];
      try {
        sessionStorage.removeItem(SESSION_LOG_KEY);
        state.sessionStorageAvailable = true;
      } catch {
        state.sessionStorageAvailable = false;
      }
      updateStorageMode();
      renderLogs();
      showToast(state.sessionStorageAvailable ? '当前会话测试日志已清空' : '内存日志已清空；浏览器阻止了会话存储操作');
    });
    $('#exportLog').addEventListener('click', () => {
      const payload = { mockLab: true, containsPii: false, exportedAt: new Date().toISOString(), events: state.logs };
      downloadBlob(JSON.stringify(payload, null, 2), 'application/json', `MOCK_BROWSER_TEST_LOG_${dateStamp()}.json`);
      addLog('导出非敏感测试日志', `事件数 ${state.logs.length}`);
    });

    $$('dialog').forEach((dialog) => {
      dialog.addEventListener('keydown', (event) => trapFocus(event, dialog));
      dialog.addEventListener('close', () => restoreDialogFocus(dialog));
    });

    document.addEventListener('keydown', (event) => {
      const drawer = $('#detailDrawer');
      if (!drawer.classList.contains('is-open') || $('dialog[open]')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDrawer();
      } else {
        trapFocus(event, drawer);
      }
    });

    window.addEventListener('hashchange', () => {
      const requestedView = window.location.hash.slice(1);
      switchView($(`[data-view-panel="${CSS.escape(requestedView)}"]`) ? requestedView : 'customers', false);
    });
  }

  function init() {
    loadRecords();
    loadLogs();
    bindEvents();
    renderTable();
    renderLogs();
    updateStorageMode();
    if (!state.recordStorageAvailable || !state.sessionStorageAvailable) {
      showToast('浏览器限制了站点存储；数据或日志仅在当前页面会话可用');
    }
    const requestedView = window.location.hash.slice(1);
    if ($(`[data-view-panel="${CSS.escape(requestedView)}"]`)) switchView(requestedView, false);
  }

  if (globalThis.__BROWSER_LAB_TEST__ === true) {
    globalThis.__BROWSER_LAB_TEST_API__ = Object.freeze({
      aadhaarValid,
      chinaIdChecksum,
      bicValid,
      clabeValid,
      createPdf,
      createInitialRecords,
      csvCell,
      exportPng,
      drawDocumentCanvas,
      ibanValid,
      luhnValid,
      maskValue,
      myNumberValid,
      passportMrzValid,
      pdfAscii,
      presentRecord,
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
