export interface LocRec {
  bookNumber: number | null; chapterNumber: number | null; documentId: number | null;
  track: number | null; issueTagNumber: number; keySymbol: string | null;
  mepsLanguage: number | null; type: number; title: string | null;
  specialty: string | null; edition: string | null;
}
/** Natural identity of a Location across backups (Title etc. excluded). */
export const locKey = (l: LocRec) => JSON.stringify([
  l.bookNumber, l.chapterNumber, l.documentId, l.track, l.issueTagNumber,
  l.keySymbol, l.mepsLanguage, l.type]);

export interface RangeRec { blockType: number; identifier: number; startToken: number | null; endToken: number | null; }
export interface MarkRec {
  guid: string; colorIndex: number; styleIndex: number; version: number;
  locKey: string; ranges: RangeRec[];
}
const sortedRanges = (m: MarkRec) =>
  [...m.ranges].sort((a, b) => a.identifier - b.identifier || (a.startToken ?? -1) - (b.startToken ?? -1))
    .map(r => [r.blockType, r.identifier, r.startToken, r.endToken]);
export const markContentKey = (m: MarkRec) => JSON.stringify([m.locKey, m.colorIndex, m.styleIndex, sortedRanges(m)]);
/** Same text marked, ignoring color/style — catches "same verse, different color" conflicts. */
export const markPlacementKey = (m: MarkRec) => JSON.stringify([m.locKey, sortedRanges(m)]);

export interface NoteRec {
  guid: string; title: string | null; content: string | null;
  lastModified: string; created: string; blockType: number; blockIdentifier: number | null;
  locKey: string | null; markGuid: string | null;
}
export const noteContentKey = (n: NoteRec) => JSON.stringify([n.locKey, n.title, n.content, n.blockType, n.blockIdentifier]);

export interface TagRec { type: number; name: string; }
export const tagKey = (t: TagRec) => JSON.stringify([t.type, t.name]);

export type TagTarget =
  | { kind: 'note'; guid: string }
  | { kind: 'location'; locKey: string }
  | { kind: 'playlistItem'; itemKey: string };
export interface TagMapRec { tagKey: string; target: TagTarget; position: number; }
export const tagMapKey = (tm: TagMapRec) => JSON.stringify([tm.tagKey, tm.target]);

export interface BookmarkRec {
  pubLocKey: string; locKey: string; slot: number; title: string; snippet: string | null;
  blockType: number; blockIdentifier: number | null;
}
export const bookmarkSlotKey = (b: BookmarkRec) => JSON.stringify([b.pubLocKey, b.slot]);
export const bookmarkContentKey = (b: BookmarkRec) =>
  JSON.stringify([b.pubLocKey, b.slot, b.locKey, b.title, b.snippet, b.blockType, b.blockIdentifier]);

export interface InputFieldRec { locKey: string; textTag: string; value: string; }
export const inputFieldKey = (f: InputFieldRec) => JSON.stringify([f.locKey, f.textTag]);

export interface MediaRec { hash: string; originalFilename: string; filePath: string; mimeType: string; bytes: Uint8Array | null; }
export interface MarkerRec {
  label: string; startTimeTicks: number; durationTicks: number; endTransitionDurationTicks: number;
  verseIds: number[];
  paragraphs: { mepsDocumentId: number; paragraphIndex: number; markerIndexWithinParagraph: number }[];
}
export interface PlaylistItemRec {
  label: string; startTrimOffsetTicks: number | null; endTrimOffsetTicks: number | null;
  accuracy: number; endAction: number; thumbnailMediaHash: string | null;
  markers: MarkerRec[];
  mediaRefs: { mediaHash: string; durationTicks: number }[];
  locationRefs: { locKey: string; majorMultimediaType: number; baseDurationTicks: number | null }[];
}
export const playlistItemKey = (p: PlaylistItemRec) => JSON.stringify([
  p.label, p.startTrimOffsetTicks, p.endTrimOffsetTicks, p.endAction,
  [...p.mediaRefs].map(m => m.mediaHash).sort(),
  [...p.locationRefs].map(l => l.locKey).sort(),
  [...p.markers].sort((a, b) => a.startTimeTicks - b.startTimeTicks).map(m => [m.label, m.startTimeTicks, m.durationTicks])]);

export interface SourceMeta {
  id: string; // unique per loaded file (filename)
  name: string; deviceName: string; lastModifiedDate: string; creationDate: string;
  type: 0 | 1; schemaVersion: number; warnings: string[];
}

export interface UserData {
  meta: SourceMeta;
  locations: Map<string, LocRec>;              // locKey → record
  marks: Map<string, MarkRec>;                 // guid → record
  notes: Map<string, NoteRec>;                 // guid → record
  tags: Map<string, TagRec>;                   // tagKey → record
  tagMaps: TagMapRec[];
  bookmarks: BookmarkRec[];
  inputFields: InputFieldRec[];
  playlistItems: Map<string, PlaylistItemRec>; // playlistItemKey → record
  media: Map<string, MediaRec>;                // hash → record (bytes from container)
}

export function emptyUserData(meta: SourceMeta): UserData {
  return {
    meta, locations: new Map(), marks: new Map(), notes: new Map(), tags: new Map(),
    tagMaps: [], bookmarks: [], inputFields: [], playlistItems: new Map(), media: new Map(),
  };
}
