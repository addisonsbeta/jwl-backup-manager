import { describe, it, expect } from 'vitest';
import { normalizeContainer } from '../src/lib/engine/normalize';
import { buildLegacyContainer } from './helpers/build';

describe('normalizeContainer (legacy v5)', () => {
  it('reads a 2017-style backup end to end', async () => {
    const bytes = await buildLegacyContainer({
      locations: [{ id: 1, keySymbol: 'nwt', book: 20, chapter: 27 }],
      marks: [{ id: 1, guid: 'OLD-MARK', loc: 1, color: 3 }],
      notes: [{ id: 1, guid: 'OLD-NOTE', loc: 1, title: 'Old', content: 'From 2017' }],
      tags: [{ id: 1, name: 'oldtag' }],
      tagMaps: [{ type: 1, typeId: 1, tag: 1 }], // tags the note
    });
    const ud = await normalizeContainer('old.jwlibrary', bytes);
    expect(ud.meta.schemaVersion).toBe(5);
    expect(ud.meta.deviceName).toBe('OldPhone');
    expect(ud.marks.get('OLD-MARK')!.colorIndex).toBe(3);
    const note = ud.notes.get('OLD-NOTE')!;
    expect(note.created).toBe(note.lastModified); // Created backfilled from LastModified
    expect(ud.tagMaps).toEqual([{ tagKey: JSON.stringify([1, 'oldtag']), target: { kind: 'note', guid: 'OLD-NOTE' }, position: 0 }]);
    expect(ud.playlistItems.size).toBe(0); // no playlist tables in v5 — no crash
  });
  it('maps legacy TagMap Type 0 to a location target', async () => {
    const bytes = await buildLegacyContainer({
      locations: [{ id: 7, keySymbol: 'w17', doc: 123 }],
      tags: [{ id: 1, name: 'favs' }],
      tagMaps: [{ type: 0, typeId: 7, tag: 1 }],
    });
    const ud = await normalizeContainer('old2.jwlibrary', bytes);
    expect(ud.tagMaps[0].target.kind).toBe('location');
  });
});
