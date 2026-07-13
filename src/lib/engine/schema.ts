import type { Database } from 'sql.js';
import { getSql } from './db';

export const CANONICAL_TABLES = [
  'BlockRange', 'Bookmark', 'IndependentMedia', 'InputField', 'LastModified', 'Location', 'Note',
  'PlaylistItem', 'PlaylistItemAccuracy', 'PlaylistItemIndependentMediaMap', 'PlaylistItemLocationMap',
  'PlaylistItemMarker', 'PlaylistItemMarkerBibleVerseMap', 'PlaylistItemMarkerParagraphMap',
  'Tag', 'TagMap', 'UserMark', 'grdb_migrations',
] as const;

// Exact v16 DDL captured from a real 2026 backup. Triggers omitted deliberately — they only
// bump LastModified, which export sets explicitly. The official Location CHECK constraints are
// omitted because they reject some legacy rows the v5 schema allowed; the UNIQUE constraint stays.
export const CANONICAL_DDL = `
CREATE TABLE grdb_migrations (identifier TEXT NOT NULL PRIMARY KEY);
CREATE TABLE "Location"(
  LocationId INTEGER NOT NULL PRIMARY KEY, BookNumber INTEGER, ChapterNumber INTEGER,
  DocumentId INTEGER, Track INTEGER, IssueTagNumber INTEGER NOT NULL DEFAULT 0,
  KeySymbol TEXT, MepsLanguage INTEGER, Type INTEGER NOT NULL,
  Title TEXT, Specialty TEXT, Edition TEXT,
  UNIQUE(BookNumber, ChapterNumber, KeySymbol, MepsLanguage, Type));
CREATE TABLE "UserMark" (
  UserMarkId INTEGER NOT NULL PRIMARY KEY, ColorIndex INTEGER NOT NULL, LocationId INTEGER NOT NULL,
  StyleIndex INTEGER NOT NULL, UserMarkGuid TEXT NOT NULL UNIQUE, Version INTEGER NOT NULL,
  FOREIGN KEY(LocationId) REFERENCES Location(LocationId));
CREATE TABLE BlockRange (
  BlockRangeId INTEGER NOT NULL PRIMARY KEY, BlockType INTEGER NOT NULL, Identifier INTEGER NOT NULL,
  StartToken INTEGER, EndToken INTEGER, UserMarkId INTEGER NOT NULL,
  CHECK (BlockType BETWEEN 1 AND 2), FOREIGN KEY(UserMarkId) REFERENCES UserMark(UserMarkId));
CREATE TABLE "Note"(
  NoteId INTEGER NOT NULL PRIMARY KEY, Guid TEXT NOT NULL UNIQUE, UserMarkId INTEGER, LocationId INTEGER,
  Title TEXT, Content TEXT,
  LastModified TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  Created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  BlockType INTEGER NOT NULL DEFAULT 0, BlockIdentifier INTEGER,
  CHECK((BlockType = 0 AND BlockIdentifier IS NULL) OR((BlockType BETWEEN 1 AND 2) AND BlockIdentifier IS NOT NULL)),
  FOREIGN KEY(UserMarkId) REFERENCES UserMark(UserMarkId),
  FOREIGN KEY(LocationId) REFERENCES Location(LocationId));
CREATE TABLE Tag(
  TagId INTEGER NOT NULL PRIMARY KEY, Type INTEGER NOT NULL, Name TEXT NOT NULL,
  UNIQUE(Type, Name), CHECK(length(Name) > 0), CHECK(Type IN (0, 1, 2)));
CREATE TABLE IndependentMedia(
  IndependentMediaId INTEGER NOT NULL PRIMARY KEY, OriginalFilename TEXT NOT NULL,
  FilePath TEXT NOT NULL UNIQUE, MimeType TEXT NOT NULL, Hash TEXT NOT NULL,
  CHECK(length(OriginalFilename) > 0), CHECK(length(FilePath) > 0), CHECK(length(MimeType) > 0), CHECK(length(Hash) > 0));
CREATE TABLE PlaylistItemAccuracy(
  PlaylistItemAccuracyId INTEGER NOT NULL PRIMARY KEY, Description TEXT NOT NULL UNIQUE);
CREATE TABLE "PlaylistItem"(
  PlaylistItemId INTEGER NOT NULL PRIMARY KEY, Label TEXT NOT NULL,
  StartTrimOffsetTicks INTEGER, EndTrimOffsetTicks INTEGER,
  Accuracy INTEGER NOT NULL, EndAction INTEGER NOT NULL, ThumbnailFilePath TEXT,
  FOREIGN KEY(Accuracy) REFERENCES PlaylistItemAccuracy(PlaylistItemAccuracyId),
  FOREIGN KEY(ThumbnailFilePath) REFERENCES IndependentMedia(FilePath),
  CHECK(length(Label) > 0), CHECK(EndAction IN(0, 1, 2, 3)));
CREATE TABLE PlaylistItemIndependentMediaMap(
  PlaylistItemId INTEGER NOT NULL, IndependentMediaId INTEGER NOT NULL, DurationTicks INTEGER NOT NULL,
  PRIMARY KEY(PlaylistItemId, IndependentMediaId),
  FOREIGN KEY(PlaylistItemId) REFERENCES PlaylistItem(PlaylistItemId),
  FOREIGN KEY(IndependentMediaId) REFERENCES IndependentMedia(IndependentMediaId)) WITHOUT ROWID;
CREATE TABLE PlaylistItemLocationMap(
  PlaylistItemId INTEGER NOT NULL, LocationId INTEGER NOT NULL,
  MajorMultimediaType INTEGER NOT NULL, BaseDurationTicks INTEGER,
  PRIMARY KEY(PlaylistItemId, LocationId),
  FOREIGN KEY(PlaylistItemId) REFERENCES PlaylistItem(PlaylistItemId),
  FOREIGN KEY(LocationId) REFERENCES Location(LocationId)) WITHOUT ROWID;
CREATE TABLE PlaylistItemMarker(
  PlaylistItemMarkerId INTEGER NOT NULL PRIMARY KEY, PlaylistItemId INTEGER NOT NULL,
  Label TEXT NOT NULL, StartTimeTicks INTEGER NOT NULL, DurationTicks INTEGER NOT NULL,
  EndTransitionDurationTicks INTEGER NOT NULL,
  UNIQUE(PlaylistItemId, StartTimeTicks),
  FOREIGN KEY(PlaylistItemId) REFERENCES PlaylistItem(PlaylistItemId));
CREATE TABLE PlaylistItemMarkerBibleVerseMap(
  PlaylistItemMarkerId INTEGER NOT NULL, VerseId INTEGER NOT NULL,
  PRIMARY KEY(PlaylistItemMarkerId, VerseId),
  FOREIGN KEY(PlaylistItemMarkerId) REFERENCES PlaylistItemMarker(PlaylistItemMarkerId)) WITHOUT ROWID;
CREATE TABLE PlaylistItemMarkerParagraphMap(
  PlaylistItemMarkerId INTEGER NOT NULL, MepsDocumentId INTEGER NOT NULL,
  ParagraphIndex INTEGER NOT NULL, MarkerIndexWithinParagraph INTEGER NOT NULL,
  PRIMARY KEY(PlaylistItemMarkerId, MepsDocumentId, ParagraphIndex, MarkerIndexWithinParagraph),
  FOREIGN KEY(PlaylistItemMarkerId) REFERENCES PlaylistItemMarker(PlaylistItemMarkerId)) WITHOUT ROWID;
CREATE TABLE "TagMap" (
  TagMapId INTEGER NOT NULL PRIMARY KEY, PlaylistItemId INTEGER, LocationId INTEGER, NoteId INTEGER,
  TagId INTEGER NOT NULL, Position INTEGER NOT NULL,
  FOREIGN KEY(TagId) REFERENCES Tag(TagId),
  FOREIGN KEY(PlaylistItemId) REFERENCES PlaylistItem(PlaylistItemId),
  FOREIGN KEY(LocationId) REFERENCES Location(LocationId),
  FOREIGN KEY(NoteId) REFERENCES Note(NoteId),
  CONSTRAINT TagId_Position UNIQUE(TagId, Position),
  CONSTRAINT TagId_NoteId UNIQUE(TagId, NoteId),
  CONSTRAINT TagId_LocationId UNIQUE(TagId, LocationId),
  CHECK((NoteId IS NULL AND LocationId IS NULL AND PlaylistItemId IS NOT NULL)
     OR (LocationId IS NULL AND PlaylistItemId IS NULL AND NoteId IS NOT NULL)
     OR (PlaylistItemId IS NULL AND NoteId IS NULL AND LocationId IS NOT NULL)));
CREATE TABLE "Bookmark" (
  BookmarkId INTEGER NOT NULL PRIMARY KEY, LocationId INTEGER NOT NULL, PublicationLocationId INTEGER NOT NULL,
  Slot INTEGER NOT NULL, Title TEXT NOT NULL, Snippet TEXT,
  BlockType INTEGER NOT NULL DEFAULT 0, BlockIdentifier INTEGER,
  FOREIGN KEY(LocationId) REFERENCES Location(LocationId),
  FOREIGN KEY(PublicationLocationId) REFERENCES Location(LocationId),
  CONSTRAINT PublicationLocationId_Slot UNIQUE (PublicationLocationId, Slot),
  CHECK((BlockType = 0 AND BlockIdentifier IS NULL) OR ((BlockType BETWEEN 1 AND 2) AND BlockIdentifier IS NOT NULL)));
CREATE TABLE "InputField"(
  LocationId INTEGER NOT NULL, TextTag TEXT NOT NULL, Value TEXT NOT NULL,
  FOREIGN KEY (LocationId) REFERENCES Location (LocationId),
  CONSTRAINT LocationId_TextTag PRIMARY KEY (LocationId, TextTag));
CREATE TABLE "LastModified"(LastModified TEXT NOT NULL);
CREATE INDEX IX_Note_LastModified_LocationId ON Note(LastModified, LocationId);
CREATE INDEX IX_Note_LocationId_BlockIdentifier ON Note(LocationId, BlockIdentifier);
CREATE INDEX IX_UserMark_LocationId ON UserMark(LocationId);
`;

export async function createCanonicalDb(): Promise<Database> {
  const SQL = await getSql();
  const db = new SQL.Database();
  db.run(CANONICAL_DDL);
  db.run(`INSERT INTO PlaylistItemAccuracy VALUES (1,'Accurate'),(2,'NeedsUserVerification')`);
  for (let v = 9; v <= 16; v++) db.run(`INSERT INTO grdb_migrations VALUES ('v${v}')`);
  return db;
}
