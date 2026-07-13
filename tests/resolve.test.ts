import { describe, it, expect } from 'vitest';
import { mergeSources } from '../src/lib/engine/merge';
import { applyResolutions, bulkDecide } from '../src/lib/engine/resolve';
import { normalizeContainer } from '../src/lib/engine/normalize';
import { buildModernContainer, type FixtureSpec } from './helpers/build';

const load = async (name: string, spec: FixtureSpec) => normalizeContainer(name, await buildModernContainer(spec));
const noteConflictPair = async () => {
  const a = await load('a', { locations: [{ id: 1, book: 20, chapter: 27 }], notes: [{ id: 1, guid: 'N1', loc: 1, title: 'T', content: 'iPhone', modified: '2026-07-12T00:00:00Z' }] });
  const b = await load('b', { locations: [{ id: 1, book: 20, chapter: 27 }], notes: [{ id: 1, guid: 'N1', loc: 1, title: 'T', content: 'iPad', modified: '2025-10-13T00:00:00Z' }] });
  return mergeSources([a, b]);
};

describe('applyResolutions', () => {
  it('left keeps left', async () => {
    const r = await noteConflictPair();
    const out = applyResolutions(r, { [r.conflicts[0].id]: 'left' });
    expect(out.notes.get('N1')!.content).toBe('iPhone');
  });
  it('right swaps in right version', async () => {
    const r = await noteConflictPair();
    const out = applyResolutions(r, { [r.conflicts[0].id]: 'right' });
    expect(out.notes.get('N1')!.content).toBe('iPad');
  });
  it('both keeps two notes with distinct guids', async () => {
    const r = await noteConflictPair();
    const out = applyResolutions(r, { [r.conflicts[0].id]: 'both' });
    expect(out.notes.size).toBe(2);
    const contents = [...out.notes.values()].map(n => n.content).sort();
    expect(contents).toEqual(['iPad', 'iPhone']);
    expect(new Set([...out.notes.keys()]).size).toBe(2);
  });
  it('merged custom text wins with newest lastModified', async () => {
    const r = await noteConflictPair();
    const out = applyResolutions(r, { [r.conflicts[0].id]: { merged: { title: 'T', content: 'combined' } } });
    const n = out.notes.get('N1')!;
    expect(n.content).toBe('combined');
    expect(n.lastModified).toBe('2026-07-12T00:00:00Z');
  });
  it('unresolved conflicts throw a clear error', async () => {
    const r = await noteConflictPair();
    expect(() => applyResolutions(r, {})).toThrow(/unresolved/i);
  });
  it('playlist both duplicates under renamed playlist', async () => {
    const base: FixtureSpec = { media: [{ id: 1, hash: 'H1', file: 'A.jpg' }], playlistItems: [{ id: 1, label: 'S', mediaRefs: [[1, 1]] }], tags: [{ id: 1, type: 2, name: 'P' }], tagMaps: [{ tag: 1, item: 1 }] };
    const ext: FixtureSpec = { ...base, playlistItems: [...base.playlistItems!, { id: 2, label: 'S2', mediaRefs: [[1, 2]] }], tagMaps: [{ tag: 1, item: 1 }, { tag: 1, item: 2 }] };
    const r = mergeSources([await load('a', base), await load('b', ext)]);
    const out = applyResolutions(r, { [r.conflicts[0].id]: 'both' });
    expect([...out.tags.values()].filter(t => t.type === 2).map(t => t.name).sort()).toEqual(['P', 'P (2)']);
  });
});

describe('bulkDecide', () => {
  it('newest wins picks the newer side per conflict', async () => {
    const r = await noteConflictPair();
    expect(bulkDecide(r.conflicts, 'newest')).toEqual({ [r.conflicts[0].id]: 'left' }); // iPhone note is newer
  });
  it('device wins matches deviceName', async () => {
    const r = await noteConflictPair();
    expect(bulkDecide(r.conflicts, { device: 'TestDevice' })).toEqual({ [r.conflicts[0].id]: 'left' });
  });
});
