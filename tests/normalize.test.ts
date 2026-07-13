import { describe, it, expect } from 'vitest';
import { normalizeContainer } from '../src/lib/engine/normalize';
import { buildModernContainer, type FixtureSpec } from './helpers/build';
import { locKey } from '../src/lib/engine/model';

const spec: FixtureSpec = {
  locations: [
    { id: 1, keySymbol: 'nwtsty', book: 20, chapter: 27, type: 0 },
    { id: 2, keySymbol: 'w26', doc: 2026123, type: 0, title: 'Study article' },
  ],
  marks: [{ id: 1, guid: 'MG-1', loc: 1, color: 2, ranges: [[1, 11, 2, 9]] }],
  notes: [{ id: 1, guid: 'NG-1', loc: 1, mark: 1, title: 'T', content: 'C' }],
  tags: [{ id: 1, name: 'talks' }, { id: 2, type: 2, name: 'My Playlist' }],
  media: [{ id: 1, hash: 'H1', file: 'A.jpg' }],
  playlistItems: [{ id: 1, label: 'Song 42', thumb: 'A.jpg', mediaRefs: [[1, 100]], markers: [{ id: 1, label: 'intro', start: 0, dur: 50 }] }],
  tagMaps: [{ tag: 1, note: 1 }, { tag: 2, item: 1 }],
  bookmarks: [{ loc: 1, pubLoc: 2, slot: 0, title: 'BM' }],
  inputFields: [{ loc: 2, tag: 'tt1', value: 'answer' }],
};

describe('normalizeContainer (modern v16)', () => {
  it('normalizes every entity into the model', async () => {
    const bytes = await buildModernContainer(spec, { 'A.jpg': new Uint8Array([1]) });
    const ud = await normalizeContainer('f.jwlibrary', bytes);
    expect(ud.meta.deviceName).toBe('TestDevice');
    expect(ud.locations.size).toBe(2);
    const mark = ud.marks.get('MG-1')!;
    expect(mark.colorIndex).toBe(2);
    expect(mark.ranges).toEqual([{ blockType: 1, identifier: 11, startToken: 2, endToken: 9 }]);
    const note = ud.notes.get('NG-1')!;
    expect(note.markGuid).toBe('MG-1');
    expect(note.locKey).toBe(locKey([...ud.locations.values()].find(l => l.bookNumber === 20)!));
    expect([...ud.tags.values()].map(t => t.name).sort()).toEqual(['My Playlist', 'talks']);
    expect(ud.playlistItems.size).toBe(1);
    const item = [...ud.playlistItems.values()][0];
    expect(item.thumbnailMediaHash).toBe('H1');
    expect(item.mediaRefs).toEqual([{ mediaHash: 'H1', durationTicks: 100 }]);
    expect(item.markers[0].label).toBe('intro');
    expect(ud.media.get('H1')!.bytes).toEqual(new Uint8Array([1]));
    expect(ud.tagMaps.length).toBe(2);
    expect(ud.bookmarks.length).toBe(1);
    expect(ud.inputFields[0].value).toBe('answer');
  });
});
