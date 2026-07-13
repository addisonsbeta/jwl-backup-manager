import { describe, it, expect } from 'vitest';
import { exportContainer, verifyContainer } from '../src/lib/engine/export';
import { mergeSources } from '../src/lib/engine/merge';
import { normalizeContainer } from '../src/lib/engine/normalize';
import { buildModernContainer, type FixtureSpec } from './helpers/build';
import { sha256Hex } from '../src/lib/engine/manifest';
import { openContainer } from '../src/lib/engine/zip';

const load = async (name: string, spec: FixtureSpec, media: Record<string, Uint8Array> = {}) =>
  normalizeContainer(name, await buildModernContainer(spec, media));

const richSpec: FixtureSpec = {
  locations: [{ id: 1, book: 20, chapter: 27 }, { id: 2, keySymbol: 'w26', doc: 9, title: 'Pub' }],
  marks: [{ id: 1, guid: 'M1', loc: 1, color: 2, ranges: [[1, 11, 2, 9]] }],
  notes: [{ id: 1, guid: 'N1', loc: 1, mark: 1, title: 'T', content: 'C' }],
  tags: [{ id: 1, name: 'talks' }, { id: 2, type: 2, name: 'PL' }],
  media: [{ id: 1, hash: 'H1', file: 'A.jpg' }],
  playlistItems: [{ id: 1, label: 'Song', thumb: 'A.jpg', mediaRefs: [[1, 100]], markers: [{ id: 1, label: 'intro', start: 0, dur: 50 }] }],
  tagMaps: [{ tag: 1, note: 1 }, { tag: 2, item: 1 }],
  bookmarks: [{ loc: 1, pubLoc: 2, slot: 0, title: 'BM' }],
  inputFields: [{ loc: 2, tag: 'tt1', value: 'ans' }],
};

describe('exportContainer', () => {
  it('round-trips: export → normalize gives identical model', async () => {
    const ud = await load('a', richSpec, { 'A.jpg': new Uint8Array([1, 2]) });
    const { fileBytes } = await exportContainer(ud, 'merged_test');
    const back = await normalizeContainer('back.jwlibrary', fileBytes);
    expect(back.marks.get('M1')!.ranges).toEqual(ud.marks.get('M1')!.ranges);
    expect(back.notes.get('N1')!.content).toBe('C');
    expect([...back.tags.values()]).toEqual(expect.arrayContaining([...ud.tags.values()]));
    expect(back.playlistItems.size).toBe(1);
    expect([...back.playlistItems.values()][0].thumbnailMediaHash).toBe('H1');
    expect(back.bookmarks.length).toBe(1);
    expect(back.inputFields[0].value).toBe('ans');
    expect(back.media.get('H1')!.bytes).toEqual(new Uint8Array([1, 2]));
  });
  it('manifest hash matches db bytes', async () => {
    const ud = await load('a', richSpec, { 'A.jpg': new Uint8Array([1]) });
    const { fileBytes } = await exportContainer(ud, 'merged_test');
    const c = openContainer(fileBytes);
    expect(c.manifestRaw.userDataBackup.hash).toBe(await sha256Hex(c.dbBytes));
    expect(c.manifestRaw.userDataBackup.schemaVersion).toBe(16);
    expect(c.manifestRaw.type).toBe(0);
  });
  it('merge with self then export equals single-source export (invariant)', async () => {
    const a = await load('a', richSpec, { 'A.jpg': new Uint8Array([1]) });
    const b = await load('b', richSpec, { 'A.jpg': new Uint8Array([1]) });
    const r = mergeSources([a, b]);
    expect(r.conflicts).toEqual([]);
    const single = await normalizeContainer('s.jwlibrary', (await exportContainer(a, 'x')).fileBytes);
    const merged = await normalizeContainer('m.jwlibrary', (await exportContainer(r.merged, 'x')).fileBytes);
    expect(merged.notes.size).toBe(single.notes.size);
    expect(merged.marks.size).toBe(single.marks.size);
    expect(merged.tagMaps.length).toBe(single.tagMaps.length);
    expect(merged.playlistItems.size).toBe(single.playlistItems.size);
  });
  it('verifyContainer reports counts and ok', async () => {
    const ud = await load('a', richSpec, { 'A.jpg': new Uint8Array([1]) });
    const { fileBytes } = await exportContainer(ud, 'merged_test');
    const v = await verifyContainer(fileBytes);
    expect(v.ok).toBe(true);
    expect(v.counts.notes).toBe(1);
    expect(v.counts.highlights).toBe(1);
    expect(v.counts.playlistItems).toBe(1);
  });
  it('exports a single playlist as .jwlplaylist (type 1)', async () => {
    const ud = await load('a', richSpec, { 'A.jpg': new Uint8Array([1]) });
    const { fileBytes } = await exportContainer(ud, 'PL', { type: 1, onlyPlaylistTagKey: JSON.stringify([2, 'PL']) });
    const c = openContainer(fileBytes);
    expect(c.manifestRaw.type).toBe(1);
    const back = await normalizeContainer('pl.jwlplaylist', fileBytes);
    expect(back.playlistItems.size).toBe(1);
    expect(back.notes.size).toBe(0); // playlist exports carry no notes
  });
});
