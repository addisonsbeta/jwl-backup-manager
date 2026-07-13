export const TARGET_SCHEMA_VERSION = 16;

export interface ParsedManifest {
  name: string;
  creationDate: string;
  type: 0 | 1;
  lastModifiedDate: string;
  deviceName: string;
  databaseName: string;
  hash: string;
  schemaVersion: number;
  warnings: string[];
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Works in browser and node ≥18 (both expose WebCrypto as globalThis.crypto)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function parseManifest(raw: any): ParsedManifest {
  const u = raw?.userDataBackup;
  if (!u) throw new Error('This backup is missing its backup information (userDataBackup) and cannot be read.');
  const warnings: string[] = [];
  const schemaVersion = Number(u.schemaVersion ?? 0);
  if (schemaVersion > TARGET_SCHEMA_VERSION)
    warnings.push(`This backup uses schema v${schemaVersion}, newer than this app understands (v${TARGET_SCHEMA_VERSION}). Loading best-effort — check the results carefully.`);
  return {
    name: String(raw.name ?? 'backup'),
    creationDate: String(raw.creationDate ?? ''),
    type: raw.type === 1 ? 1 : 0,
    lastModifiedDate: String(u.lastModifiedDate ?? ''),
    deviceName: String(u.deviceName ?? 'unknown device'),
    databaseName: String(u.databaseName ?? 'userData.db'),
    hash: String(u.hash ?? ''),
    schemaVersion,
    warnings,
  };
}

export async function generateManifest(dbBytes: Uint8Array, opts: { name: string; type: 0 | 1; deviceName: string }) {
  const now = new Date();
  const iso = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return {
    name: opts.name,
    creationDate: iso.slice(0, 10),
    version: 1,
    type: opts.type,
    userDataBackup: {
      lastModifiedDate: iso,
      deviceName: opts.deviceName,
      databaseName: 'userData.db',
      hash: await sha256Hex(dbBytes),
      schemaVersion: TARGET_SCHEMA_VERSION,
    },
  };
}
