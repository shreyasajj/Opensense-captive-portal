const {
  normalizePhone,
  parseVCard,
  extractMonthDay,
  validateBirthday,
} = require('../../services/carddav');

describe('normalizePhone', () => {
  test('strips dashes and spaces', () => {
    expect(normalizePhone('555-123-4567')).toBe('5551234567');
  });

  test('strips leading + and country code zeros', () => {
    expect(normalizePhone('+1-555-123-4567')).toBe('15551234567');
  });

  test('strips parentheses and dots', () => {
    expect(normalizePhone('(555) 123.4567')).toBe('5551234567');
  });

  test('removes leading zeros', () => {
    expect(normalizePhone('00491234567')).toBe('491234567');
  });

  test('returns empty string for null/undefined', () => {
    expect(normalizePhone(null)).toBe('');
    expect(normalizePhone(undefined)).toBe('');
    expect(normalizePhone('')).toBe('');
  });
});

describe('parseVCard', () => {
  test('parses a standard vCard', () => {
    const vcard = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:John Doe',
      'TEL;TYPE=CELL:+1-555-123-4567',
      'TEL;TYPE=HOME:555-987-6543',
      'BDAY:1990-06-15',
      'UID:abc-123',
      'END:VCARD',
    ].join('\r\n');

    const result = parseVCard(vcard);
    expect(result.name).toBe('John Doe');
    expect(result.phones).toHaveLength(2);
    expect(result.phones[0]).toBe('+1-555-123-4567');
    expect(result.phones[1]).toBe('555-987-6543');
    expect(result.birthday).toBe('1990-06-15');
    expect(result.uid).toBe('abc-123');
  });

  test('parses vCard with no birthday', () => {
    const vcard = [
      'BEGIN:VCARD',
      'FN:Jane Smith',
      'TEL:555-000-1111',
      'UID:xyz-456',
      'END:VCARD',
    ].join('\r\n');

    const result = parseVCard(vcard);
    expect(result.name).toBe('Jane Smith');
    expect(result.phones).toEqual(['555-000-1111']);
    expect(result.birthday).toBe('');
  });

  test('handles folded lines (continuation with space)', () => {
    const vcard = [
      'BEGIN:VCARD',
      'FN:Very Long',
      'TEL;TYPE=CELL;VALUE=uri:tel:+15551234567',
      'END:VCARD',
    ].join('\r\n');

    const result = parseVCard(vcard);
    expect(result.phones.length).toBeGreaterThanOrEqual(1);
  });

  test('returns empty arrays/strings for empty vCard', () => {
    const vcard = 'BEGIN:VCARD\r\nEND:VCARD';
    const result = parseVCard(vcard);
    expect(result.phones).toEqual([]);
    expect(result.name).toBe('');
    expect(result.birthday).toBe('');
    expect(result.uid).toBe('');
  });
});

describe('extractMonthDay', () => {
  test('parses YYYY-MM-DD', () => {
    expect(extractMonthDay('1990-06-15')).toEqual({ month: 6, day: 15 });
  });

  test('parses YYYYMMDD', () => {
    expect(extractMonthDay('19900615')).toEqual({ month: 6, day: 15 });
  });

  test('parses --MMDD', () => {
    expect(extractMonthDay('--0615')).toEqual({ month: 6, day: 15 });
  });

  test('parses --MM-DD', () => {
    expect(extractMonthDay('--06-15')).toEqual({ month: 6, day: 15 });
  });

  test('parses MM-DD', () => {
    expect(extractMonthDay('06-15')).toEqual({ month: 6, day: 15 });
  });

  test('parses MM/DD', () => {
    expect(extractMonthDay('06/15')).toEqual({ month: 6, day: 15 });
  });

  test('returns null for empty or invalid input', () => {
    expect(extractMonthDay('')).toBeNull();
    expect(extractMonthDay(null)).toBeNull();
    expect(extractMonthDay(undefined)).toBeNull();
    expect(extractMonthDay('invalid')).toBeNull();
  });

  test('handles whitespace', () => {
    expect(extractMonthDay('  1990-06-15  ')).toEqual({ month: 6, day: 15 });
  });
});

describe('validateBirthday', () => {
  test('matches when month and day are the same', () => {
    const contact = { birthday: '1990-06-15' };
    expect(validateBirthday(contact, '2000-06-15')).toBe(true);
  });

  test('rejects when month differs', () => {
    const contact = { birthday: '1990-06-15' };
    expect(validateBirthday(contact, '2000-07-15')).toBe(false);
  });

  test('rejects when day differs', () => {
    const contact = { birthday: '1990-06-15' };
    expect(validateBirthday(contact, '2000-06-16')).toBe(false);
  });

  test('matches across different formats', () => {
    const contact = { birthday: '--0615' };
    expect(validateBirthday(contact, '1990-06-15')).toBe(true);
  });

  test('returns false when contact has no birthday', () => {
    const contact = { birthday: '' };
    expect(validateBirthday(contact, '2000-06-15')).toBe(false);
  });

  test('returns false when input is empty', () => {
    const contact = { birthday: '1990-06-15' };
    expect(validateBirthday(contact, '')).toBe(false);
  });
});
