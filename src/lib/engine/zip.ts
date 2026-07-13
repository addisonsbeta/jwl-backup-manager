import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';

export interface Container {
  manifestRaw: any;
  dbBytes: Uint8Array;
  dbName: string;
  media: Map<string, Uint8Array>; // every non-manifest, non-db entry
}

export function openContainer(bytes: Uint8Array): Container {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error('This is not a valid backup file (not a ZIP archive).');
  }
  const manifestBytes = entries['manifest.json'];
  if (!manifestBytes) throw new Error("This doesn't look like a JW Library backup — it's missing manifest.json.");
  let manifestRaw: any;
  try {
    manifestRaw = JSON.parse(strFromU8(manifestBytes));
  } catch {
    throw new Error("This doesn't look like a JW Library backup — manifest.json is unreadable.");
  }
  const dbName: string = manifestRaw?.userDataBackup?.databaseName ?? 'userData.db';
  const dbBytes = entries[dbName];
  if (!dbBytes) throw new Error(`This doesn't look like a JW Library backup — database "${dbName}" is missing.`);
  const media = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(entries)) {
    if (name !== 'manifest.json' && name !== dbName) media.set(name, data);
  }
  return { manifestRaw, dbBytes, dbName, media };
}

export function packContainer(input: { manifest: any; dbName: string; dbBytes: Uint8Array; media: Map<string, Uint8Array> }): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(input.manifest)),
    [input.dbName]: input.dbBytes,
  };
  for (const [name, data] of input.media) files[name] = data;
  return zipSync(files);
}
