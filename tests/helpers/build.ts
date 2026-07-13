import { createCanonicalDb } from '../../src/lib/engine/schema';
import { exportDb, getSql } from '../../src/lib/engine/db';
import { packContainer } from '../../src/lib/engine/zip';
import { generateManifest } from '../../src/lib/engine/manifest';

export interface FixtureSpec {
  device?: string;
  locations?: { id: number; keySymbol?: string; book?: number; chapter?: number; doc?: number; type?: number; title?: string }[];
  marks?: { id: number; guid: string; loc: number; color?: number; ranges?: [number, number, number, number][] }[]; // [blockType, identifier, start, end]
  notes?: { id: number; guid: string; loc?: number; mark?: number; title?: string; content?: string; modified?: string; created?: string }[];
  tags?: { id: number; type?: number; name: string }[];
  tagMaps?: { tag: number; note?: number; loc?: number; item?: number; position?: number }[];
  bookmarks?: { loc: number; pubLoc: number; slot: number; title: string; snippet?: string }[];
  inputFields?: { loc: number; tag: string; value: string }[];
  media?: { id: number; hash: string; file: string; mime?: string; original?: string }[];
  playlistItems?: { id: number; label: string; thumb?: string; mediaRefs?: [number, number][]; locRefs?: [number, number][]; markers?: { id: number; label: string; start: number; dur: number }[] }[];
}

export async function buildModernDbBytes(s: FixtureSpec): Promise<Uint8Array> {
  const db = await createCanonicalDb();
  for (const l of s.locations ?? [])
    db.run(`INSERT INTO Location(LocationId,BookNumber,ChapterNumber,DocumentId,KeySymbol,MepsLanguage,Type,Title,IssueTagNumber) VALUES (?,?,?,?,?,?,?,?,0)`,
      [l.id, l.book ?? null, l.chapter ?? null, l.doc ?? null, l.keySymbol ?? 'nwtsty', 0, l.type ?? 0, l.title ?? null]);
  for (const m of s.marks ?? []) {
    db.run(`INSERT INTO UserMark(UserMarkId,ColorIndex,LocationId,StyleIndex,UserMarkGuid,Version) VALUES (?,?,?,0,?,1)`,
      [m.id, m.color ?? 1, m.loc, m.guid]);
    for (const [bt, ident, st, en] of m.ranges ?? [[1, 1, 0, 5] as [number, number, number, number]])
      db.run(`INSERT INTO BlockRange(BlockType,Identifier,StartToken,EndToken,UserMarkId) VALUES (?,?,?,?,?)`, [bt, ident, st, en, m.id]);
  }
  for (const n of s.notes ?? [])
    db.run(`INSERT INTO Note(NoteId,Guid,UserMarkId,LocationId,Title,Content,LastModified,Created) VALUES (?,?,?,?,?,?,?,?)`,
      [n.id, n.guid, n.mark ?? null, n.loc ?? null, n.title ?? null, n.content ?? null,
        n.modified ?? '2026-01-01T00:00:00Z', n.created ?? '2026-01-01T00:00:00Z']);
  for (const t of s.tags ?? []) db.run(`INSERT INTO Tag(TagId,Type,Name) VALUES (?,?,?)`, [t.id, t.type ?? 1, t.name]);
  for (const m of s.media ?? [])
    db.run(`INSERT INTO IndependentMedia(IndependentMediaId,OriginalFilename,FilePath,MimeType,Hash) VALUES (?,?,?,?,?)`,
      [m.id, m.original ?? m.file, m.file, m.mime ?? 'image/jpeg', m.hash]);
  for (const p of s.playlistItems ?? []) {
    db.run(`INSERT INTO PlaylistItem(PlaylistItemId,Label,Accuracy,EndAction,ThumbnailFilePath) VALUES (?,?,1,0,?)`, [p.id, p.label, p.thumb ?? null]);
    for (const [mediaId, dur] of p.mediaRefs ?? [])
      db.run(`INSERT INTO PlaylistItemIndependentMediaMap VALUES (?,?,?)`, [p.id, mediaId, dur]);
    for (const [locId, mmt] of p.locRefs ?? [])
      db.run(`INSERT INTO PlaylistItemLocationMap(PlaylistItemId,LocationId,MajorMultimediaType) VALUES (?,?,?)`, [p.id, locId, mmt]);
    for (const mk of p.markers ?? [])
      db.run(`INSERT INTO PlaylistItemMarker(PlaylistItemMarkerId,PlaylistItemId,Label,StartTimeTicks,DurationTicks,EndTransitionDurationTicks) VALUES (?,?,?,?,?,0)`,
        [mk.id, p.id, mk.label, mk.start, mk.dur]);
  }
  let pos = 0;
  for (const tm of s.tagMaps ?? [])
    db.run(`INSERT INTO TagMap(PlaylistItemId,LocationId,NoteId,TagId,Position) VALUES (?,?,?,?,?)`,
      [tm.item ?? null, tm.loc ?? null, tm.note ?? null, tm.tag, tm.position ?? pos++]);
  for (const b of s.bookmarks ?? [])
    db.run(`INSERT INTO Bookmark(LocationId,PublicationLocationId,Slot,Title,Snippet) VALUES (?,?,?,?,?)`,
      [b.loc, b.pubLoc, b.slot, b.title, b.snippet ?? null]);
  for (const f of s.inputFields ?? [])
    db.run(`INSERT INTO InputField(LocationId,TextTag,Value) VALUES (?,?,?)`, [f.loc, f.tag, f.value]);
  db.run(`INSERT INTO LastModified VALUES ('2026-01-01T00:00:00Z')`);
  const bytes = exportDb(db);
  db.close();
  return bytes;
}

export async function buildModernContainer(s: FixtureSpec, mediaFiles: Record<string, Uint8Array> = {}, type: 0 | 1 = 0): Promise<Uint8Array> {
  const dbBytes = await buildModernDbBytes(s);
  const manifest = await generateManifest(dbBytes, { name: 'fixture', type, deviceName: s.device ?? 'TestDevice' });
  return packContainer({ manifest, dbName: 'userData.db', dbBytes, media: new Map(Object.entries(mediaFiles)) });
}

export const LEGACY_V5_DDL = `
CREATE TABLE Location (LocationId INTEGER NOT NULL PRIMARY KEY, BookNumber INTEGER, ChapterNumber INTEGER,
  DocumentId INTEGER, Track INTEGER, IssueTagNumber INTEGER NOT NULL DEFAULT 0,
  KeySymbol TEXT NOT NULL, MepsLanguage INTEGER NOT NULL, Type INTEGER NOT NULL, Title TEXT);
CREATE TABLE UserMark (UserMarkId INTEGER NOT NULL PRIMARY KEY, ColorIndex INTEGER NOT NULL,
  LocationId INTEGER NOT NULL, StyleIndex INTEGER NOT NULL, UserMarkGuid TEXT NOT NULL UNIQUE, Version INTEGER NOT NULL);
CREATE TABLE BlockRange (BlockRangeId INTEGER NOT NULL PRIMARY KEY, BlockType INTEGER NOT NULL,
  Identifier INTEGER NOT NULL, StartToken INTEGER, EndToken INTEGER, UserMarkId INTEGER NOT NULL);
CREATE TABLE Note (NoteId INTEGER NOT NULL PRIMARY KEY, Guid TEXT NOT NULL UNIQUE, UserMarkId INTEGER,
  LocationId INTEGER, Title TEXT, Content TEXT,
  LastModified TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  BlockType INTEGER NOT NULL DEFAULT 0, BlockIdentifier INTEGER);
CREATE TABLE Tag (TagId INTEGER NOT NULL PRIMARY KEY, Type INTEGER NOT NULL, Name TEXT NOT NULL,
  LastModified TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
CREATE TABLE TagMap (TagMapId INTEGER NOT NULL PRIMARY KEY, Type INTEGER NOT NULL, TypeId INTEGER NOT NULL,
  TagId INTEGER NOT NULL, Position INTEGER NOT NULL);
CREATE TABLE Bookmark (BookmarkId INTEGER NOT NULL PRIMARY KEY, PublicationLocationId INTEGER NOT NULL,
  LocationId INTEGER NOT NULL, Slot INTEGER NOT NULL, Title TEXT NOT NULL, Snippet TEXT,
  BlockType INTEGER NOT NULL DEFAULT 0, BlockIdentifier INTEGER);
CREATE TABLE LastModified (LastModified TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
`;

export async function buildLegacyContainer(s: {
  locations?: { id: number; keySymbol: string; book?: number; chapter?: number; doc?: number; type?: number }[];
  marks?: { id: number; guid: string; loc: number; color?: number }[];
  notes?: { id: number; guid: string; loc?: number; title?: string; content?: string; modified?: string }[];
  tags?: { id: number; name: string }[];
  tagMaps?: { type: 0 | 1; typeId: number; tag: number; position?: number }[];
}): Promise<Uint8Array> {
  const SQL = await getSql();
  const db = new SQL.Database();
  db.run(LEGACY_V5_DDL);
  for (const l of s.locations ?? [])
    db.run(`INSERT INTO Location(LocationId,BookNumber,ChapterNumber,DocumentId,KeySymbol,MepsLanguage,Type) VALUES (?,?,?,?,?,0,?)`,
      [l.id, l.book ?? null, l.chapter ?? null, l.doc ?? null, l.keySymbol, l.type ?? 0]);
  for (const m of s.marks ?? []) {
    db.run(`INSERT INTO UserMark VALUES (?,?,?,0,?,1)`, [m.id, m.color ?? 1, m.loc, m.guid]);
    db.run(`INSERT INTO BlockRange(BlockType,Identifier,StartToken,EndToken,UserMarkId) VALUES (1,1,0,5,?)`, [m.id]);
  }
  for (const n of s.notes ?? [])
    db.run(`INSERT INTO Note(NoteId,Guid,LocationId,Title,Content,LastModified) VALUES (?,?,?,?,?,?)`,
      [n.id, n.guid, n.loc ?? null, n.title ?? null, n.content ?? null, n.modified ?? '2017-09-01T00:00:00Z']);
  for (const t of s.tags ?? []) db.run(`INSERT INTO Tag(TagId,Type,Name) VALUES (?,1,?)`, [t.id, t.name]);
  let pos = 0;
  for (const tm of s.tagMaps ?? [])
    db.run(`INSERT INTO TagMap(Type,TypeId,TagId,Position) VALUES (?,?,?,?)`, [tm.type, tm.typeId, tm.tag, tm.position ?? pos++]);
  db.run(`INSERT INTO LastModified(LastModified) VALUES ('2017-09-01T00:00:00Z')`);
  const dbBytes = db.export();
  db.close();
  return packContainer({
    manifest: {
      name: 'legacy', creationDate: '2017-09-26', version: 1, type: 0,
      userDataBackup: { lastModifiedDate: '2017-09-25T17:17:09-05:00', deviceName: 'OldPhone', databaseName: 'user_data.db', hash: 'x', schemaVersion: 5 },
    },
    dbName: 'user_data.db', dbBytes, media: new Map(),
  });
}
