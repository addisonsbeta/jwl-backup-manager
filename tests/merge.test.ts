import { describe, it, expect } from 'vitest';
import { mergeSources } from '../src/lib/engine/merge';
import { normalizeContainer } from '../src/lib/engine/normalize';
import { buildModernContainer, type FixtureSpec } from './helpers/build';

const load = async (name: string, spec: FixtureSpec) => normalizeContainer(name, await buildModernContainer(spec));

describe('mergeSources — marks & notes', () => {
  it('dedupes identical items (same GUID) silently', async () => {
    const spec: FixtureSpec = {
      locations: [{ id: 1, book: 20, chapter: 27 }],
      marks: [{ id: 1, guid: 'M1', loc: 1, color: 1 }],
      notes: [{ id: 1, guid: 'N1', loc: 1, title: 'T', content: 'C' }],
    };
    const r = mergeSources([await load('a', spec), await load('b', spec)]);
    expect(r.conflicts).toEqual([]);
    expect(r.merged.marks.size).toBe(1);
    expect(r.merged.notes.size).toBe(1);
  });
  it('dedupes identical content with different GUIDs', async () => {
    const a = await load('a', { locations: [{ id: 1, book: 20, chapter: 27 }], notes: [{ id: 1, guid: 'N1', loc: 1, title: 'T', content: 'C' }] });
    const b = await load('b', { locations: [{ id: 1, book: 20, chapter: 27 }], notes: [{ id: 1, guid: 'N-OTHER', loc: 1, title: 'T', content: 'C' }] });
    const r = mergeSources([a, b]);
    expect(r.conflicts).toEqual([]);
    expect(r.merged.notes.size).toBe(1);
  });
  it('conflicts when same note GUID has different content', async () => {
    const a = await load('a', { locations: [{ id: 1, book: 20, chapter: 27 }], notes: [{ id: 1, guid: 'N1', loc: 1, title: 'T', content: 'iPhone text', modified: '2026-07-12T00:00:00Z' }] });
    const b = await load('b', { locations: [{ id: 1, book: 20, chapter: 27 }], notes: [{ id: 1, guid: 'N1', loc: 1, title: 'T', content: 'iPad text', modified: '2025-10-13T00:00:00Z' }] });
    const r = mergeSources([a, b]);
    expect(r.conflicts.length).toBe(1);
    const c = r.conflicts[0];
    expect(c.kind).toBe('note');
    expect((c.left.item as any).content).toBe('iPhone text');
    expect((c.right.item as any).content).toBe('iPad text');
    expect(c.left.sourceId).toBe('a');
    // merged keeps LEFT until resolved
    expect(r.merged.notes.get('N1')!.content).toBe('iPhone text');
  });
  it('conflicts when same text is highlighted in different colors', async () => {
    const mk = (guid: string, color: number): FixtureSpec => ({ locations: [{ id: 1, book: 20, chapter: 27 }], marks: [{ id: 1, guid, loc: 1, color, ranges: [[1, 5, 0, 9]] }] });
    const r = mergeSources([await load('a', mk('MA', 1)), await load('b', mk('MB', 4))]);
    expect(r.conflicts.length).toBe(1);
    expect(r.conflicts[0].kind).toBe('mark');
  });
  it('single-source items pass through; locations union without dupes', async () => {
    const a = await load('a', { locations: [{ id: 1, book: 20, chapter: 27 }], marks: [{ id: 1, guid: 'MA', loc: 1 }] });
    const b = await load('b', { locations: [{ id: 9, book: 20, chapter: 27 }, { id: 2, book: 43, chapter: 3 }], marks: [{ id: 1, guid: 'MB', loc: 2, ranges: [[1, 7, 1, 4]] }] });
    const r = mergeSources([a, b]);
    expect(r.conflicts).toEqual([]);
    expect(r.merged.marks.size).toBe(2);
    expect(r.merged.locations.size).toBe(2); // (20,27) deduped across sources
  });
});
