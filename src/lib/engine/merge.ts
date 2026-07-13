import {
  emptyUserData, markContentKey, markPlacementKey, noteContentKey,
  bookmarkSlotKey, bookmarkContentKey, inputFieldKey, tagMapKey,
  type UserData, type NoteRec, type MarkRec, type BookmarkRec, type InputFieldRec,
} from './model';

export interface ConflictSide<T> {
  sourceId: string; sourceName: string; deviceName: string; lastModifiedDate: string; item: T;
}
export interface PlaylistSnapshot { tagKey: string; name: string; itemKeys: string[]; }
export type Conflict =
  | { id: string; kind: 'note'; left: ConflictSide<NoteRec>; right: ConflictSide<NoteRec> }
  | { id: string; kind: 'mark'; left: ConflictSide<MarkRec>; right: ConflictSide<MarkRec> }
  | { id: string; kind: 'bookmark'; left: ConflictSide<BookmarkRec>; right: ConflictSide<BookmarkRec> }
  | { id: string; kind: 'inputField'; left: ConflictSide<InputFieldRec>; right: ConflictSide<InputFieldRec> }
  | { id: string; kind: 'playlist'; left: ConflictSide<PlaylistSnapshot>; right: ConflictSide<PlaylistSnapshot> };

export interface MergeResult { merged: UserData; conflicts: Conflict[]; }

const side = <T>(ud: UserData, item: T): ConflictSide<T> => ({
  sourceId: ud.meta.id, sourceName: ud.meta.name, deviceName: ud.meta.deviceName,
  lastModifiedDate: ud.meta.lastModifiedDate, item,
});

export function mergeSources(sources: UserData[]): MergeResult {
  if (sources.length === 0) throw new Error('No sources to merge.');
  const conflicts: Conflict[] = [];
  let cid = 0;
  const nextId = () => `c${++cid}`;

  const acc = cloneUserData(sources[0], {
    id: 'merged', name: 'merged', deviceName: 'JWL Backup Manager',
    lastModifiedDate: sources[0].meta.lastModifiedDate, creationDate: sources[0].meta.creationDate,
    type: 0, schemaVersion: 16, warnings: sources.flatMap(s => s.meta.warnings),
  });
  // remember which source each accumulated item came from, for conflict labeling
  const noteOrigin = new Map<string, UserData>();
  const markOrigin = new Map<string, UserData>();
  for (const g of acc.notes.keys()) noteOrigin.set(g, sources[0]);
  for (const g of acc.marks.keys()) markOrigin.set(g, sources[0]);

  for (const src of sources.slice(1)) {
    // Locations
    for (const [k, loc] of src.locations) {
      const existing = acc.locations.get(k);
      if (!existing) acc.locations.set(k, { ...loc });
      else if (!existing.title && loc.title) existing.title = loc.title;
    }
    // Media (by content hash)
    for (const [h, m] of src.media) {
      const existing = acc.media.get(h);
      if (!existing) acc.media.set(h, { ...m });
      else if (!existing.bytes && m.bytes) existing.bytes = m.bytes;
    }
    // Marks
    const accByContent = new Map([...acc.marks.values()].map(m => [markContentKey(m), m] as const));
    const accByPlacement = new Map([...acc.marks.values()].map(m => [markPlacementKey(m), m] as const));
    for (const [guid, mark] of src.marks) {
      const dup = acc.marks.get(guid);
      if (dup) {
        if (markContentKey(dup) !== markContentKey(mark))
          conflicts.push({ id: nextId(), kind: 'mark', left: side(markOrigin.get(guid) ?? sources[0], dup), right: side(src, mark) });
        continue;
      }
      if (accByContent.has(markContentKey(mark))) continue; // identical, different guid
      const placed = accByPlacement.get(markPlacementKey(mark));
      if (placed) { // same text, different color/style
        conflicts.push({ id: nextId(), kind: 'mark', left: side(markOrigin.get(placed.guid) ?? sources[0], placed), right: side(src, mark) });
        continue;
      }
      acc.marks.set(guid, { ...mark, ranges: mark.ranges.map(r => ({ ...r })) });
      markOrigin.set(guid, src);
      accByContent.set(markContentKey(mark), acc.marks.get(guid)!);
      accByPlacement.set(markPlacementKey(mark), acc.marks.get(guid)!);
    }
    // Notes
    const notesByContent = new Map([...acc.notes.values()].map(n => [noteContentKey(n), n] as const));
    for (const [guid, note] of src.notes) {
      const dup = acc.notes.get(guid);
      if (dup) {
        if (noteContentKey(dup) !== noteContentKey(note))
          conflicts.push({ id: nextId(), kind: 'note', left: side(noteOrigin.get(guid) ?? sources[0], dup), right: side(src, note) });
        continue;
      }
      if (notesByContent.has(noteContentKey(note))) continue;
      acc.notes.set(guid, { ...note });
      noteOrigin.set(guid, src);
      notesByContent.set(noteContentKey(note), acc.notes.get(guid)!);
    }
    mergeRest(acc, src, conflicts, nextId); // tags/tagMaps/playlists/bookmarks/inputFields
  }
  return { merged: acc, conflicts };
}

export function cloneUserData(src: UserData, meta: UserData['meta']): UserData {
  const ud = emptyUserData(meta);
  for (const [k, v] of src.locations) ud.locations.set(k, { ...v });
  for (const [k, v] of src.marks) ud.marks.set(k, { ...v, ranges: v.ranges.map(r => ({ ...r })) });
  for (const [k, v] of src.notes) ud.notes.set(k, { ...v });
  for (const [k, v] of src.tags) ud.tags.set(k, { ...v });
  ud.tagMaps = src.tagMaps.map(t => ({ ...t, target: { ...t.target } as any }));
  ud.bookmarks = src.bookmarks.map(b => ({ ...b }));
  ud.inputFields = src.inputFields.map(f => ({ ...f }));
  for (const [k, v] of src.playlistItems)
    ud.playlistItems.set(k, {
      ...v,
      markers: v.markers.map(m => ({ ...m, verseIds: [...m.verseIds], paragraphs: m.paragraphs.map(p => ({ ...p })) })),
      mediaRefs: v.mediaRefs.map(m => ({ ...m })),
      locationRefs: v.locationRefs.map(l => ({ ...l })),
    });
  for (const [k, v] of src.media) ud.media.set(k, { ...v });
  return ud;
}

function mergeRest(acc: UserData, src: UserData, conflicts: Conflict[], nextId: () => string): void {
  // Playlist items are pure content — union by content key (membership handled via playlists below)
  for (const [k, item] of src.playlistItems)
    if (!acc.playlistItems.has(k))
      acc.playlistItems.set(k, {
        ...item,
        markers: item.markers.map(m => ({ ...m, verseIds: [...m.verseIds], paragraphs: m.paragraphs.map(p => ({ ...p })) })),
        mediaRefs: item.mediaRefs.map(m => ({ ...m })),
        locationRefs: item.locationRefs.map(l => ({ ...l })),
      });

  // Detect playlist conflicts BEFORE folding tags/tagMaps
  const playlistMembers = (ud: UserData, tk: string) =>
    ud.tagMaps.filter(t => t.tagKey === tk && t.target.kind === 'playlistItem')
      .sort((x, y) => x.position - y.position)
      .map(t => (t.target as { kind: 'playlistItem'; itemKey: string }).itemKey);
  const conflictedPlaylistTags = new Set<string>();
  for (const [tk, tag] of src.tags) {
    if (tag.type !== 2 || !acc.tags.has(tk)) continue;
    const l = playlistMembers(acc, tk), r = playlistMembers(src, tk);
    if (JSON.stringify(l) !== JSON.stringify(r)) {
      conflictedPlaylistTags.add(tk);
      conflicts.push({
        id: nextId(), kind: 'playlist',
        left: side(acc, { tagKey: tk, name: tag.name, itemKeys: l }),
        right: side(src, { tagKey: tk, name: tag.name, itemKeys: r }),
      });
    }
  }

  // Tags
  for (const [tk, tag] of src.tags) if (!acc.tags.has(tk)) acc.tags.set(tk, { ...tag });

  // TagMaps — dedupe by (tag, target); skip members of conflicted playlists (resolve decides those)
  const seen = new Set(acc.tagMaps.map(tagMapKey));
  for (const tm of src.tagMaps) {
    if (conflictedPlaylistTags.has(tm.tagKey) && tm.target.kind === 'playlistItem') continue;
    const k = tagMapKey(tm);
    if (seen.has(k)) continue;
    seen.add(k);
    acc.tagMaps.push({ ...tm, target: { ...tm.target } as any });
  }

  // Bookmarks
  const bySlot = new Map(acc.bookmarks.map(b => [bookmarkSlotKey(b), b] as const));
  const byContent = new Set(acc.bookmarks.map(bookmarkContentKey));
  for (const bm of src.bookmarks) {
    if (byContent.has(bookmarkContentKey(bm))) continue;
    const clash = bySlot.get(bookmarkSlotKey(bm));
    if (clash) {
      conflicts.push({ id: nextId(), kind: 'bookmark', left: side(acc, clash), right: side(src, bm) });
      continue;
    }
    const copy = { ...bm };
    acc.bookmarks.push(copy);
    bySlot.set(bookmarkSlotKey(copy), copy);
    byContent.add(bookmarkContentKey(copy));
  }

  // InputFields
  const fieldByKey = new Map(acc.inputFields.map(f => [inputFieldKey(f), f] as const));
  for (const f of src.inputFields) {
    const existing = fieldByKey.get(inputFieldKey(f));
    if (!existing) {
      const copy = { ...f };
      acc.inputFields.push(copy);
      fieldByKey.set(inputFieldKey(copy), copy);
      continue;
    }
    if (existing.value !== f.value)
      conflicts.push({ id: nextId(), kind: 'inputField', left: side(acc, existing), right: side(src, f) });
  }
}
