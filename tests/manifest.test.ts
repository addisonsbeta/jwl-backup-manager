import { describe, it, expect } from 'vitest';
import { parseManifest, generateManifest, sha256Hex } from '../src/lib/engine/manifest';

describe('sha256Hex', () => {
  it('computes padded sha256', async () => {
    // sha256("abc") — well-known vector
    expect(await sha256Hex(new TextEncoder().encode('abc')))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('parseManifest', () => {
  const good = { name: 'b', creationDate: '2026-07-13', version: 1, type: 0,
    userDataBackup: { lastModifiedDate: '2026-07-13T00:00:00Z', deviceName: 'iPhone', databaseName: 'userData.db', hash: 'x', schemaVersion: 16 } };
  it('accepts a valid backup manifest', () => {
    const m = parseManifest(good);
    expect(m.type).toBe(0);
    expect(m.schemaVersion).toBe(16);
    expect(m.deviceName).toBe('iPhone');
  });
  it('accepts playlist type 1', () => {
    expect(parseManifest({ ...good, type: 1 }).type).toBe(1);
  });
  it('flags unknown future schema as warning, not error', () => {
    const m = parseManifest({ ...good, userDataBackup: { ...good.userDataBackup, schemaVersion: 99 } });
    expect(m.warnings.some(w => /newer than this app understands/i.test(w))).toBe(true);
  });
  it('rejects manifest without userDataBackup', () => {
    expect(() => parseManifest({ name: 'x' })).toThrow(/missing its backup information/i);
  });
});

describe('generateManifest', () => {
  it('produces importable manifest with real hash', async () => {
    const db = new Uint8Array([1, 2, 3]);
    const m = await generateManifest(db, { name: 'merged_2026-07-13', type: 0, deviceName: 'JWL Backup Manager' });
    expect(m.userDataBackup.hash).toBe(await sha256Hex(db));
    expect(m.userDataBackup.schemaVersion).toBe(16);
    expect(m.userDataBackup.databaseName).toBe('userData.db');
    expect(m.version).toBe(1);
  });
});
