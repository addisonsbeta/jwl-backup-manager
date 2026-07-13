import { describe, it, expect } from 'vitest';
import { openContainer, packContainer } from '../src/lib/engine/zip';
import { zipSync, strToU8 } from 'fflate';

const mkZip = (files: Record<string, Uint8Array>) => zipSync(files);

describe('openContainer', () => {
  it('splits manifest, db and media', () => {
    const db = new Uint8Array([1, 2, 3]);
    const zip = mkZip({
      'manifest.json': strToU8(JSON.stringify({ name: 'x', userDataBackup: { databaseName: 'userData.db' } })),
      'userData.db': db,
      'ABC.mp4': new Uint8Array([9]),
    });
    const c = openContainer(zip);
    expect(c.manifestRaw.name).toBe('x');
    expect(c.dbBytes).toEqual(db);
    expect([...c.media.keys()]).toEqual(['ABC.mp4']);
  });
  it('honors databaseName user_data.db (2017 backups)', () => {
    const zip = mkZip({
      'manifest.json': strToU8(JSON.stringify({ userDataBackup: { databaseName: 'user_data.db' } })),
      'user_data.db': new Uint8Array([7]),
    });
    expect(openContainer(zip).dbBytes).toEqual(new Uint8Array([7]));
  });
  it('rejects zip without manifest.json', () => {
    expect(() => openContainer(mkZip({ 'x.db': new Uint8Array([1]) })))
      .toThrow(/doesn't look like a JW Library backup/i);
  });
  it('rejects non-zip bytes', () => {
    expect(() => openContainer(new Uint8Array([1, 2, 3, 4]))).toThrow(/not a valid backup file/i);
  });
  it('round-trips through packContainer', () => {
    const packed = packContainer({ manifest: { a: 1 }, dbName: 'userData.db', dbBytes: new Uint8Array([5]), media: new Map([['m.jpg', new Uint8Array([6])]]) });
    const c = openContainer(packed);
    expect(c.manifestRaw.a).toBe(1);
    expect(c.dbBytes).toEqual(new Uint8Array([5]));
    expect(c.media.get('m.jpg')).toEqual(new Uint8Array([6]));
  });
});
