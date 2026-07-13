import { describe, it, expect } from 'vitest';
import { mergeSources } from '../src/lib/engine/merge';
import { normalizeContainer } from '../src/lib/engine/normalize';
import { buildModernContainer, type FixtureSpec } from './helpers/build';

const load = async (name: string, spec: FixtureSpec, media: Record<string, Uint8Array> = {}) =>
  normalizeContainer(name, await buildModernContainer(spec, media));

describe('mergeSources — tags/playlists/bookmarks/inputFields', () => {
  it('unions tags and tag assignments without duplicates', async () => {
    const a = await load('a', { locations: [{ id: 1, book: 20, chapter: 27 }], notes: [{ id: 1, guid: 'N1', loc: 1, title: 'T', content: 'C' }], tags: [{ id: 1, name: 'talks' }], tagMaps: [{ tag: 1, note: 1 }] });
    const b = await load('b', { locations: [{ id: 1, book: 20, chapter: 27 }], notes: [{ id: 1, guid: 'N1', loc: 1, title: 'T', content: 'C' }], tags: [{ id: 1, name: 'talks' }, { id: 2, name: 'extra' }], tagMaps: [{ tag: 1, note: 1 }, { tag: 2, note: 1 }] });
    const r = mergeSources([a, b]);
    expect(r.conflicts).toEqual([]);
    expect(r.merged.tags.size).toBe(2);
    expect(r.merged.tagMaps.length).toBe(2); // (talks→N1) deduped
  });
  it('identical playlists merge silently; differing same-name playlists conflict', async () => {
    const base: FixtureSpec = {
      media: [{ id: 1, hash: 'H1', file: 'A.jpg' }],
      playlistItems: [{ id: 1, label: 'Song 42', mediaRefs: [[1, 100]] }],
      tags: [{ id: 1, type: 2, name: 'My Talk' }],
      tagMaps: [{ tag: 1, item: 1 }],
    };
    const extended: FixtureSpec = {
      media: [{ id: 1, hash: 'H1', file: 'A.jpg' }, { id: 2, hash: 'H2', file: 'B.mp4', mime: 'video/mp4' }],
      playlistItems: [{ id: 1, label: 'Song 42', mediaRefs: [[1, 100]] }, { id: 2, label: 'Opening video', mediaRefs: [[2, 900]] }],
      tags: [{ id: 1, type: 2, name: 'My Talk' }],
      tagMaps: [{ tag: 1, item: 1 }, { tag: 1, item: 2 }],
    };
    const same = mergeSources([await load('a', base), await load('b', base)]);
    expect(same.conflicts).toEqual([]);
    expect(same.merged.playlistItems.size).toBe(1);

    const diff = mergeSources([await load('a', base), await load('b', extended)]);
    expect(diff.conflicts.length).toBe(1);
    expect(diff.conflicts[0].kind).toBe('playlist');
    expect((diff.conflicts[0].right.item as any).itemKeys.length).toBe(2);
    // all items still available in merged storage (membership decided at resolve)
    expect(diff.merged.playlistItems.size).toBe(2);
  });
  it('bookmark same slot different target conflicts; different slots union', async () => {
    const locs = [{ id: 1, book: 20, chapter: 27 }, { id: 2, book: 43, chapter: 3 }, { id: 3, keySymbol: 'w26', doc: 1, title: 'Pub' }];
    const a = await load('a', { locations: locs, bookmarks: [{ loc: 1, pubLoc: 3, slot: 0, title: 'Prov' }] });
    const b = await load('b', { locations: locs, bookmarks: [{ loc: 2, pubLoc: 3, slot: 0, title: 'John' }, { loc: 1, pubLoc: 3, slot: 1, title: 'Prov' }] });
    const r = mergeSources([a, b]);
    expect(r.conflicts.length).toBe(1);
    expect(r.conflicts[0].kind).toBe('bookmark');
    expect(r.merged.bookmarks.length).toBe(2); // slot0 (left kept until resolve) + slot1
  });
  it('input field same key different value conflicts', async () => {
    const locs = [{ id: 1, keySymbol: 'lff', doc: 5, title: 'Lesson' }];
    const a = await load('a', { locations: locs, inputFields: [{ loc: 1, tag: 'tt1', value: 'my answer' }] });
    const b = await load('b', { locations: locs, inputFields: [{ loc: 1, tag: 'tt1', value: 'different answer' }] });
    const r = mergeSources([a, b]);
    expect(r.conflicts.length).toBe(1);
    expect(r.conflicts[0].kind).toBe('inputField');
  });
});
