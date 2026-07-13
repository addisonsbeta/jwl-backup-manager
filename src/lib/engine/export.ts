import type { Database } from 'sql.js';
import { createCanonicalDb } from './schema';
import { exportDb, openDb } from './db';
import { generateManifest, sha256Hex } from './manifest';
import { packContainer, openContainer } from './zip';
import type { UserData } from './model';

export interface ExportOptions { type?: 0 | 1; onlyPlaylistTagKey?: string; }
export interface ExportResult { fileBytes: Uint8Array; fileName: string; }

export async function exportContainer(ud: UserData, baseName: string, opts: ExportOptions = {}): Promise<ExportResult> {
  const type = opts.type ?? 0;
  const data = opts.onlyPlaylistTagKey ? filterToPlaylist(ud, opts.onlyPlaylistTagKey) : ud;
  const db = await createCanonicalDb();
  const media = writeDb(db, data);
  const dbBytes = exportDb(db);
  db.close();
  const manifest = await generateManifest(dbBytes, { name: baseName, type, deviceName: 'JWL Backup Manager' });
  const fileBytes = packContainer({ manifest, dbName: 'userData.db', dbBytes, media });
  return { fileBytes, fileName: `${baseName}.${type === 1 ? 'jwlplaylist' : 'jwlibrary'}` };
}

function filterToPlaylist(ud: UserData, tagKeyWanted: string): UserData {
  const memberKeys = new Set(ud.tagMaps
    .filter(t => t.tagKey === tagKeyWanted && t.target.kind === 'playlistItem')
    .map(t => (t.target as { itemKey: string }).itemKey));
  const out: UserData = {
    ...ud,
    notes: new Map(), marks: new Map(), bookmarks: [], inputFields: [],
    tags: new Map([...ud.tags].filter(([k]) => k === tagKeyWanted)),
    tagMaps: ud.tagMaps.filter(t => t.tagKey === tagKeyWanted && t.target.kind === 'playlistItem'),
    playlistItems: new Map([...ud.playlistItems].filter(([k]) => memberKeys.has(k))),
    locations: new Map(), media: new Map(),
  };
  const usedHashes = new Set<string>();
  const usedLocs = new Set<string>();
  for (const item of out.playlistItems.values()) {
    for (const m of item.mediaRefs) usedHashes.add(m.mediaHash);
    if (item.thumbnailMediaHash) usedHashes.add(item.thumbnailMediaHash);
    for (const l of item.locationRefs) usedLocs.add(l.locKey);
  }
  out.media = new Map([...ud.media].filter(([h]) => usedHashes.has(h)));
  out.locations = new Map([...ud.locations].filter(([k]) => usedLocs.has(k)));
  return out;
}

/** Writes the model into a canonical db. Returns the media file map for the zip. */
function writeDb(db: Database, ud: UserData): Map<string, Uint8Array> {
  // Locations
  const locIds = new Map<string, number>();
  let locId = 0;
  for (const [k, l] of ud.locations) {
    locIds.set(k, ++locId);
    db.run(`INSERT INTO Location(LocationId,BookNumber,ChapterNumber,DocumentId,Track,IssueTagNumber,KeySymbol,MepsLanguage,Type,Title,Specialty,Edition) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [locId, l.bookNumber, l.chapterNumber, l.documentId, l.track, l.issueTagNumber, l.keySymbol, l.mepsLanguage, l.type, l.title, l.specialty, l.edition]);
  }
  const locIdOf = (k: string | null) => (k != null ? locIds.get(k) ?? null : null);

  // Media — unique zip filenames; PlaylistItem.ThumbnailFilePath FK needs final paths
  const mediaFiles = new Map<string, Uint8Array>();
  const mediaIds = new Map<string, number>();
  const mediaPath = new Map<string, string>();
  const takenPaths = new Set<string>();
  let mediaId = 0;
  for (const [h, m] of ud.media) {
    let path = m.filePath;
    while (takenPaths.has(path)) path = `${mediaId}_${path}`;
    takenPaths.add(path);
    mediaIds.set(h, ++mediaId);
    mediaPath.set(h, path);
    db.run(`INSERT INTO IndependentMedia(IndependentMediaId,OriginalFilename,FilePath,MimeType,Hash) VALUES (?,?,?,?,?)`,
      [mediaId, m.originalFilename, path, m.mimeType, m.hash]);
    if (m.bytes) mediaFiles.set(path, m.bytes);
  }

  // UserMarks + BlockRanges
  const markIds = new Map<string, number>();
  let markId = 0, rangeId = 0;
  for (const [guid, m] of ud.marks) {
    const lid = locIdOf(m.locKey);
    if (lid == null) continue;
    markIds.set(guid, ++markId);
    db.run(`INSERT INTO UserMark(UserMarkId,ColorIndex,LocationId,StyleIndex,UserMarkGuid,Version) VALUES (?,?,?,?,?,?)`,
      [markId, m.colorIndex, lid, m.styleIndex, guid, m.version]);
    for (const r of m.ranges)
      db.run(`INSERT INTO BlockRange(BlockRangeId,BlockType,Identifier,StartToken,EndToken,UserMarkId) VALUES (?,?,?,?,?,?)`,
        [++rangeId, r.blockType, r.identifier, r.startToken, r.endToken, markId]);
  }

  // Notes
  const noteIds = new Map<string, number>();
  let noteId = 0;
  for (const [guid, n] of ud.notes) {
    noteIds.set(guid, ++noteId);
    db.run(`INSERT INTO Note(NoteId,Guid,UserMarkId,LocationId,Title,Content,LastModified,Created,BlockType,BlockIdentifier) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [noteId, guid, n.markGuid ? markIds.get(n.markGuid) ?? null : null, locIdOf(n.locKey),
        n.title, n.content, n.lastModified, n.created, n.blockType, n.blockIdentifier]);
  }

  // PlaylistItems (+ markers + maps)
  const itemIds = new Map<string, number>();
  let itemId = 0, markerId = 0;
  for (const [k, p] of ud.playlistItems) {
    itemIds.set(k, ++itemId);
    db.run(`INSERT INTO PlaylistItem(PlaylistItemId,Label,StartTrimOffsetTicks,EndTrimOffsetTicks,Accuracy,EndAction,ThumbnailFilePath) VALUES (?,?,?,?,?,?,?)`,
      [itemId, p.label, p.startTrimOffsetTicks, p.endTrimOffsetTicks, p.accuracy, p.endAction,
        p.thumbnailMediaHash ? mediaPath.get(p.thumbnailMediaHash) ?? null : null]);
    for (const m of p.mediaRefs) {
      const mid = mediaIds.get(m.mediaHash);
      if (mid) db.run(`INSERT INTO PlaylistItemIndependentMediaMap VALUES (?,?,?)`, [itemId, mid, m.durationTicks]);
    }
    for (const l of p.locationRefs) {
      const lid = locIdOf(l.locKey);
      if (lid) db.run(`INSERT INTO PlaylistItemLocationMap VALUES (?,?,?,?)`, [itemId, lid, l.majorMultimediaType, l.baseDurationTicks]);
    }
    for (const mk of p.markers) {
      db.run(`INSERT INTO PlaylistItemMarker VALUES (?,?,?,?,?,?)`,
        [++markerId, itemId, mk.label, mk.startTimeTicks, mk.durationTicks, mk.endTransitionDurationTicks]);
      for (const v of mk.verseIds) db.run(`INSERT INTO PlaylistItemMarkerBibleVerseMap VALUES (?,?)`, [markerId, v]);
      for (const pp of mk.paragraphs)
        db.run(`INSERT INTO PlaylistItemMarkerParagraphMap VALUES (?,?,?,?)`, [markerId, pp.mepsDocumentId, pp.paragraphIndex, pp.markerIndexWithinParagraph]);
    }
  }

  // Tags + TagMaps (Position renumbered per tag: unique, ordered)
  const tagIds = new Map<string, number>();
  let tagId = 0;
  for (const [k, t] of ud.tags) {
    tagIds.set(k, ++tagId);
    db.run(`INSERT INTO Tag(TagId,Type,Name) VALUES (?,?,?)`, [tagId, t.type, t.name]);
  }
  let tagMapId = 0;
  const byTag = new Map<string, typeof ud.tagMaps>();
  for (const tm of ud.tagMaps) {
    if (!byTag.has(tm.tagKey)) byTag.set(tm.tagKey, []);
    byTag.get(tm.tagKey)!.push(tm);
  }
  for (const [tk, maps] of byTag) {
    const tid = tagIds.get(tk);
    if (!tid) continue;
    maps.sort((a, b) => a.position - b.position);
    let pos = 0;
    for (const tm of maps) {
      let pid: number | null = null, lid: number | null = null, nid: number | null = null;
      if (tm.target.kind === 'playlistItem') { pid = itemIds.get(tm.target.itemKey) ?? null; if (!pid) continue; }
      if (tm.target.kind === 'location') { lid = locIdOf(tm.target.locKey); if (!lid) continue; }
      if (tm.target.kind === 'note') { nid = noteIds.get(tm.target.guid) ?? null; if (!nid) continue; }
      db.run(`INSERT INTO TagMap(TagMapId,PlaylistItemId,LocationId,NoteId,TagId,Position) VALUES (?,?,?,?,?,?)`,
        [++tagMapId, pid, lid, nid, tid, pos++]);
    }
  }

  // Bookmarks + InputFields + LastModified
  let bmId = 0;
  for (const b of ud.bookmarks) {
    const lid = locIdOf(b.locKey), pid = locIdOf(b.pubLocKey);
    if (lid && pid) db.run(`INSERT INTO Bookmark(BookmarkId,LocationId,PublicationLocationId,Slot,Title,Snippet,BlockType,BlockIdentifier) VALUES (?,?,?,?,?,?,?,?)`,
      [++bmId, lid, pid, b.slot, b.title, b.snippet, b.blockType, b.blockIdentifier]);
  }
  for (const f of ud.inputFields) {
    const lid = locIdOf(f.locKey);
    if (lid) db.run(`INSERT INTO InputField(LocationId,TextTag,Value) VALUES (?,?,?)`, [lid, f.textTag, f.value]);
  }
  db.run(`INSERT INTO LastModified VALUES (?)`, [new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')]);
  return mediaFiles;
}

export interface Verification {
  ok: boolean;
  problems: string[];
  counts: { notes: number; highlights: number; playlistItems: number; tags: number; bookmarks: number; inputFields: number; locations: number; media: number };
}

export async function verifyContainer(fileBytes: Uint8Array): Promise<Verification> {
  const problems: string[] = [];
  const c = openContainer(fileBytes);
  if (c.manifestRaw.userDataBackup.hash !== await sha256Hex(c.dbBytes)) problems.push('Manifest hash does not match database bytes.');
  const db = await openDb(c.dbBytes);
  try {
    const fk = db.exec(`PRAGMA foreign_key_check`);
    if (fk.length && fk[0].values.length) problems.push(`Foreign key violations: ${fk[0].values.length}`);
    const integrity = db.exec(`PRAGMA integrity_check`)[0].values[0][0];
    if (integrity !== 'ok') problems.push(`Integrity check: ${integrity}`);
    const count = (t: string) => Number(db.exec(`SELECT COUNT(*) FROM ${t}`)[0].values[0][0]);
    const counts = {
      notes: count('Note'), highlights: count('UserMark'), playlistItems: count('PlaylistItem'),
      tags: count('Tag'), bookmarks: count('Bookmark'), inputFields: count('InputField'),
      locations: count('Location'), media: count('IndependentMedia'),
    };
    // every media row must exist in the zip (sources sometimes lack bytes; flag, don't crash)
    for (const [path] of db.exec(`SELECT FilePath FROM IndependentMedia`)[0]?.values ?? [])
      if (!c.media.has(String(path))) problems.push(`Media file missing from archive: ${path}`);
    return { ok: problems.length === 0, problems, counts };
  } finally {
    db.close();
  }
}
