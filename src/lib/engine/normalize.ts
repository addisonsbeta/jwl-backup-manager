import type { Database } from 'sql.js';
import { openContainer } from './zip';
import { parseManifest } from './manifest';
import { openDb } from './db';
import {
  emptyUserData, locKey, playlistItemKey, tagKey,
  type UserData, type LocRec, type MarkRec, type NoteRec, type TagMapRec,
  type PlaylistItemRec, type MarkerRec, type SourceMeta,
} from './model';

const rows = (db: Database, sql: string): any[][] => db.exec(sql)[0]?.values ?? [];
const hasTable = (db: Database, name: string) =>
  rows(db, `SELECT 1 FROM sqlite_master WHERE type='table' AND name='${name}'`).length > 0;
const columns = (db: Database, table: string): string[] =>
  rows(db, `PRAGMA table_info(${table})`).map(r => String(r[1]));

export async function normalizeContainer(fileId: string, bytes: Uint8Array): Promise<UserData> {
  const c = openContainer(bytes);
  const m = parseManifest(c.manifestRaw);
  const db = await openDb(c.dbBytes);
  try {
    return normalizeDb(db, {
      id: fileId, name: m.name, deviceName: m.deviceName, lastModifiedDate: m.lastModifiedDate,
      creationDate: m.creationDate, type: m.type, schemaVersion: m.schemaVersion, warnings: [...m.warnings],
    }, c.media);
  } finally {
    db.close();
  }
}

export function normalizeDb(db: Database, meta: SourceMeta, mediaFiles: Map<string, Uint8Array>): UserData {
  const ud = emptyUserData(meta);

  // Location — build integer-id → locKey mapping
  const locCols = columns(db, 'Location');
  const has = (c: string) => locCols.includes(c);
  const idToLoc = new Map<number, string>();
  for (const r of rows(db, `SELECT LocationId, BookNumber, ChapterNumber, DocumentId, Track, IssueTagNumber, KeySymbol, MepsLanguage, Type, Title${has('Specialty') ? ', Specialty' : ''}${has('Edition') ? ', Edition' : ''} FROM Location`)) {
    const [id, book, chap, doc, track, issue, key, lang, type, title, spec, ed] = r as any[];
    const loc: LocRec = {
      bookNumber: book ?? null, chapterNumber: chap ?? null, documentId: doc ?? null,
      track: track ?? null, issueTagNumber: issue ?? 0, keySymbol: key ?? null, mepsLanguage: lang ?? null,
      type, title: title ?? null, specialty: spec ?? null, edition: ed ?? null,
    };
    const k = locKey(loc);
    if (!ud.locations.has(k)) ud.locations.set(k, loc);
    else if (!ud.locations.get(k)!.title && loc.title) ud.locations.get(k)!.title = loc.title;
    idToLoc.set(Number(id), k);
  }

  // UserMark + BlockRange
  const markIdToGuid = new Map<number, string>();
  for (const [id, color, locId, style, guid, version] of rows(db, `SELECT UserMarkId, ColorIndex, LocationId, StyleIndex, UserMarkGuid, Version FROM UserMark`) as any[]) {
    const mark: MarkRec = { guid, colorIndex: color, styleIndex: style, version, locKey: idToLoc.get(Number(locId))!, ranges: [] };
    ud.marks.set(guid, mark);
    markIdToGuid.set(Number(id), guid);
  }
  for (const [bt, ident, st, en, umId] of rows(db, `SELECT BlockType, Identifier, StartToken, EndToken, UserMarkId FROM BlockRange`) as any[]) {
    const g = markIdToGuid.get(Number(umId));
    if (g) ud.marks.get(g)!.ranges.push({ blockType: bt, identifier: ident, startToken: st ?? null, endToken: en ?? null });
  }

  // Note (v5 has no Created column)
  const noteHasCreated = columns(db, 'Note').includes('Created');
  const noteIdToGuid = new Map<number, string>();
  for (const [id, guid, umId, locId, title, content, lastMod, created, bt, bi] of
    rows(db, `SELECT NoteId, Guid, UserMarkId, LocationId, Title, Content, LastModified, ${noteHasCreated ? 'Created' : 'LastModified'}, BlockType, BlockIdentifier FROM Note`) as any[]) {
    const n: NoteRec = {
      guid, title: title ?? null, content: content ?? null, lastModified: lastMod, created,
      blockType: bt, blockIdentifier: bi ?? null,
      locKey: locId != null ? idToLoc.get(Number(locId)) ?? null : null,
      markGuid: umId != null ? markIdToGuid.get(Number(umId)) ?? null : null,
    };
    ud.notes.set(guid, n);
    noteIdToGuid.set(Number(id), guid);
  }

  // Tag
  const tagIdToKey = new Map<number, string>();
  for (const [id, type, name] of rows(db, `SELECT TagId, Type, Name FROM Tag`) as any[]) {
    const t = { type, name };
    const k = tagKey(t);
    ud.tags.set(k, t);
    tagIdToKey.set(Number(id), k);
  }

  // IndependentMedia (+ bytes from the container)
  const mediaIdToHash = new Map<number, string>();
  const pathToHash = new Map<string, string>();
  if (hasTable(db, 'IndependentMedia')) {
    for (const [id, orig, path, mime, hash] of rows(db, `SELECT IndependentMediaId, OriginalFilename, FilePath, MimeType, Hash FROM IndependentMedia`) as any[]) {
      ud.media.set(hash, { hash, originalFilename: orig, filePath: path, mimeType: mime, bytes: mediaFiles.get(path) ?? null });
      mediaIdToHash.set(Number(id), hash);
      pathToHash.set(path, hash);
    }
  }

  // PlaylistItem + markers + maps
  const itemIdToKey = new Map<number, string>();
  if (hasTable(db, 'PlaylistItem')) {
    const markersByItem = new Map<number, MarkerRec[]>();
    const markerIdTo = new Map<number, MarkerRec>();
    if (hasTable(db, 'PlaylistItemMarker')) {
      for (const [mid, pid, label, start, dur, endTrans] of rows(db, `SELECT PlaylistItemMarkerId, PlaylistItemId, Label, StartTimeTicks, DurationTicks, EndTransitionDurationTicks FROM PlaylistItemMarker`) as any[]) {
        const rec: MarkerRec = { label, startTimeTicks: start, durationTicks: dur, endTransitionDurationTicks: endTrans, verseIds: [], paragraphs: [] };
        markerIdTo.set(Number(mid), rec);
        if (!markersByItem.has(Number(pid))) markersByItem.set(Number(pid), []);
        markersByItem.get(Number(pid))!.push(rec);
      }
      if (hasTable(db, 'PlaylistItemMarkerBibleVerseMap'))
        for (const [mid, v] of rows(db, `SELECT PlaylistItemMarkerId, VerseId FROM PlaylistItemMarkerBibleVerseMap`) as any[])
          markerIdTo.get(Number(mid))?.verseIds.push(Number(v));
      if (hasTable(db, 'PlaylistItemMarkerParagraphMap'))
        for (const [mid, docId, para, idx] of rows(db, `SELECT PlaylistItemMarkerId, MepsDocumentId, ParagraphIndex, MarkerIndexWithinParagraph FROM PlaylistItemMarkerParagraphMap`) as any[])
          markerIdTo.get(Number(mid))?.paragraphs.push({ mepsDocumentId: docId, paragraphIndex: para, markerIndexWithinParagraph: idx });
    }
    const mediaRefsByItem = new Map<number, { mediaHash: string; durationTicks: number }[]>();
    if (hasTable(db, 'PlaylistItemIndependentMediaMap'))
      for (const [pid, mid, dur] of rows(db, `SELECT PlaylistItemId, IndependentMediaId, DurationTicks FROM PlaylistItemIndependentMediaMap`) as any[]) {
        if (!mediaRefsByItem.has(Number(pid))) mediaRefsByItem.set(Number(pid), []);
        const h = mediaIdToHash.get(Number(mid));
        if (h) mediaRefsByItem.get(Number(pid))!.push({ mediaHash: h, durationTicks: dur });
      }
    const locRefsByItem = new Map<number, { locKey: string; majorMultimediaType: number; baseDurationTicks: number | null }[]>();
    if (hasTable(db, 'PlaylistItemLocationMap'))
      for (const [pid, locId, mmt, base] of rows(db, `SELECT PlaylistItemId, LocationId, MajorMultimediaType, BaseDurationTicks FROM PlaylistItemLocationMap`) as any[]) {
        if (!locRefsByItem.has(Number(pid))) locRefsByItem.set(Number(pid), []);
        const k = idToLoc.get(Number(locId));
        if (k) locRefsByItem.get(Number(pid))!.push({ locKey: k, majorMultimediaType: mmt, baseDurationTicks: base ?? null });
      }
    for (const [id, label, st, et, acc, endAction, thumb] of rows(db, `SELECT PlaylistItemId, Label, StartTrimOffsetTicks, EndTrimOffsetTicks, Accuracy, EndAction, ThumbnailFilePath FROM PlaylistItem`) as any[]) {
      const rec: PlaylistItemRec = {
        label, startTrimOffsetTicks: st ?? null, endTrimOffsetTicks: et ?? null,
        accuracy: acc, endAction, thumbnailMediaHash: thumb != null ? pathToHash.get(thumb) ?? null : null,
        markers: markersByItem.get(Number(id)) ?? [], mediaRefs: mediaRefsByItem.get(Number(id)) ?? [],
        locationRefs: locRefsByItem.get(Number(id)) ?? [],
      };
      const k = playlistItemKey(rec);
      ud.playlistItems.set(k, rec);
      itemIdToKey.set(Number(id), k);
    }
  }

  // TagMap — modern (explicit FK columns) vs legacy (Type/TypeId)
  normalizeTagMaps(db, ud, { tagIdToKey, noteIdToGuid, idToLoc, itemIdToKey });

  // Bookmark
  for (const [locId, pubLocId, slot, title, snippet, bt, bi] of rows(db, `SELECT LocationId, PublicationLocationId, Slot, Title, Snippet, BlockType, BlockIdentifier FROM Bookmark`) as any[]) {
    const lk = idToLoc.get(Number(locId)), pk = idToLoc.get(Number(pubLocId));
    if (lk && pk) ud.bookmarks.push({ pubLocKey: pk, locKey: lk, slot, title, snippet: snippet ?? null, blockType: bt, blockIdentifier: bi ?? null });
  }

  // InputField
  if (hasTable(db, 'InputField'))
    for (const [locId, tt, val] of rows(db, `SELECT LocationId, TextTag, Value FROM InputField`) as any[]) {
      const lk = idToLoc.get(Number(locId));
      if (lk) ud.inputFields.push({ locKey: lk, textTag: tt, value: val });
    }

  return ud;
}

interface TagMapCtx {
  tagIdToKey: Map<number, string>;
  noteIdToGuid: Map<number, string>;
  idToLoc: Map<number, string>;
  itemIdToKey: Map<number, string>;
}

function normalizeTagMaps(db: Database, ud: UserData, ctx: TagMapCtx) {
  const cols = columns(db, 'TagMap');
  if (cols.includes('NoteId')) { // modern
    for (const [pid, locId, noteId, tagId, pos] of rows(db, `SELECT PlaylistItemId, LocationId, NoteId, TagId, Position FROM TagMap`) as any[]) {
      const tk = ctx.tagIdToKey.get(Number(tagId));
      if (!tk) continue;
      let target: TagMapRec['target'] | null = null;
      if (noteId != null) { const g = ctx.noteIdToGuid.get(Number(noteId)); if (g) target = { kind: 'note', guid: g }; }
      else if (locId != null) { const k = ctx.idToLoc.get(Number(locId)); if (k) target = { kind: 'location', locKey: k }; }
      else if (pid != null) { const k = ctx.itemIdToKey.get(Number(pid)); if (k) target = { kind: 'playlistItem', itemKey: k }; }
      if (target) ud.tagMaps.push({ tagKey: tk, target, position: Number(pos) });
    }
  } else { // legacy v5: Type 0 = Location, 1 = Note
    for (const [type, typeId, tagId, pos] of rows(db, `SELECT Type, TypeId, TagId, Position FROM TagMap`) as any[]) {
      const tk = ctx.tagIdToKey.get(Number(tagId));
      if (!tk) continue;
      let target: TagMapRec['target'] | null = null;
      if (Number(type) === 1) { const g = ctx.noteIdToGuid.get(Number(typeId)); if (g) target = { kind: 'note', guid: g }; }
      else { const k = ctx.idToLoc.get(Number(typeId)); if (k) target = { kind: 'location', locKey: k }; }
      // Legacy safety net: if the primary interpretation found nothing, try the other table.
      if (!target) {
        const g = ctx.noteIdToGuid.get(Number(typeId));
        const k = ctx.idToLoc.get(Number(typeId));
        if (Number(type) === 1 && k) target = { kind: 'location', locKey: k };
        else if (Number(type) !== 1 && g) target = { kind: 'note', guid: g };
      }
      if (target) ud.tagMaps.push({ tagKey: tk, target, position: Number(pos) });
    }
  }
}
