const { normalizeMacAddress } = require('../../services/opnsense');

describe('normalizeMacAddress', () => {
  test('normalizes colon-separated MAC', () => {
    expect(normalizeMacAddress('aa:bb:cc:dd:ee:ff')).toBe('AA:BB:CC:DD:EE:FF');
  });

  test('normalizes dash-separated MAC', () => {
    expect(normalizeMacAddress('aa-bb-cc-dd-ee-ff')).toBe('AA:BB:CC:DD:EE:FF');
  });

  test('normalizes MAC without separators', () => {
    expect(normalizeMacAddress('aabbccddeeff')).toBe('AA:BB:CC:DD:EE:FF');
  });

  test('uppercases lowercase MAC', () => {
    expect(normalizeMacAddress('ab:cd:ef:01:23:45')).toBe('AB:CD:EF:01:23:45');
  });

  test('returns null for invalid MAC (too short)', () => {
    expect(normalizeMacAddress('aa:bb:cc')).toBeNull();
  });

  test('returns null for invalid MAC (too long)', () => {
    expect(normalizeMacAddress('aa:bb:cc:dd:ee:ff:00')).toBeNull();
  });

  test('returns null for null/undefined/empty', () => {
    expect(normalizeMacAddress(null)).toBeNull();
    expect(normalizeMacAddress(undefined)).toBeNull();
    expect(normalizeMacAddress('')).toBeNull();
  });

  test('handles mixed-case input', () => {
    expect(normalizeMacAddress('Ab:Cd:Ef:01:23:45')).toBe('AB:CD:EF:01:23:45');
  });

  test('strips non-hex characters', () => {
    expect(normalizeMacAddress('AA:BB:CC:DD:EE:FF')).toBe('AA:BB:CC:DD:EE:FF');
  });
});
