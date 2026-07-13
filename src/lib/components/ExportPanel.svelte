<script lang="ts">
  import { sources, mergeResult, decisions, unresolvedCount, phase } from '../stores';
  import { applyResolutions } from '../engine/resolve';
  import { exportContainer, verifyContainer, type Verification } from '../engine/export';
  import { tagKey, type UserData } from '../engine/model';

  let busy = $state(false);
  let verification = $state<Verification | null>(null);
  let error = $state('');
  let finalData = $state<UserData | null>(null);

  const playlists = $derived(finalData ? [...finalData.tags.values()].filter(t => t.type === 2) : []);

  function download(bytes: Uint8Array, name: string) {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    a.click();
    URL.revokeObjectURL(url);
  }
  async function doExport() {
    if (!$mergeResult) return;
    busy = true;
    error = '';
    verification = null;
    try {
      finalData = applyResolutions($mergeResult, $decisions);
      const name = `merged_${new Date().toISOString().slice(0, 10)}`;
      const { fileBytes, fileName } = await exportContainer(finalData, name);
      verification = await verifyContainer(fileBytes);
      if (verification.ok || confirm(`Verification warnings:\n${verification.problems.join('\n')}\n\nDownload anyway?`))
        download(fileBytes, fileName);
    } catch (e: any) {
      error = e.message;
    }
    busy = false;
  }
  async function exportPlaylist(name: string) {
    if (!finalData) return;
    const { fileBytes, fileName } = await exportContainer(finalData, name.replace(/[^\w\- ]+/g, '_'),
      { type: 1, onlyPlaylistTagKey: tagKey({ type: 2, name }) });
    download(fileBytes, fileName);
  }
</script>

<div class="card">
  <h2 style="margin-top:0">Export merged backup</h2>
  {#if $unresolvedCount > 0}
    <p style="color:#fbbf24">⚠️ {$unresolvedCount} conflict(s) still unresolved —
      <button class="ghost" onclick={() => phase.set('resolve')}>resolve them first</button></p>
  {:else}
    <p style="color:#94a3b8;font-size:13.5px">Combines {$sources.filter(s => s.included).length} source(s) into one <b>.jwlibrary</b> file.
      Restore it in JW Library via Personal Study → Backup and Restore.
      <b style="color:#fda4af">Restoring replaces that device's data</b> — check the verification summary first.</p>
    <button class="primary" disabled={busy || !$mergeResult} onclick={doExport}>{busy ? 'Building…' : '⬇︎ Build & download merged backup'}</button>
  {/if}
  {#if error}<p style="color:#fda4af">✗ {error}</p>{/if}

  {#if verification}
    <div style="margin-top:16px;border-radius:12px;padding:14px 16px;background:{verification.ok ? 'rgba(52,211,153,.12)' : 'rgba(251,191,36,.1)'};border:1px solid {verification.ok ? 'rgba(52,211,153,.4)' : 'rgba(251,191,36,.4)'}">
      <b style="color:{verification.ok ? '#6ee7b7' : '#fbbf24'}">{verification.ok ? '✓ Verified — re-opened the output and checked hash, integrity, and foreign keys' : '⚠ Verified with warnings'}</b>
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:10px;color:#cbd5e1;font-size:13px">
        <span>📝 {verification.counts.notes} notes</span>
        <span>🖍️ {verification.counts.highlights} highlights</span>
        <span>🎬 {verification.counts.playlistItems} playlist items</span>
        <span>🏷️ {verification.counts.tags} tags</span>
        <span>🔖 {verification.counts.bookmarks} bookmarks</span>
        <span>✍️ {verification.counts.inputFields} answers</span>
      </div>
      {#each verification.problems as p (p)}<div style="color:#fbbf24;font-size:12.5px;margin-top:6px">• {p}</div>{/each}
    </div>
  {/if}

  {#if playlists.length}
    <h3 style="margin:22px 0 8px">Share individual playlists</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      {#each playlists as p (p.name)}
        <button class="ghost" onclick={() => exportPlaylist(p.name)}>🎬 {p.name} → .jwlplaylist</button>
      {/each}
    </div>
  {/if}
</div>
