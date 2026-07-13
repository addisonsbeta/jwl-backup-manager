<script lang="ts">
  import { addFiles, loadErrors, sources, phase } from '../stores';

  let dragging = $state(false);
  let busy = $state(false);

  async function handle(files: FileList | null) {
    if (!files?.length) return;
    busy = true;
    await addFiles([...files]);
    busy = false;
    if ($sources.length) phase.set('explore');
  }
</script>

<div class="card" role="button" tabindex="0"
  style="border:2px dashed {dragging ? '#818cf8' : 'rgba(148,163,184,.3)'};text-align:center;padding:56px 20px;cursor:pointer;
         transform:{dragging ? 'scale(1.01)' : 'none'}"
  ondragover={e => { e.preventDefault(); dragging = true; }}
  ondragleave={() => (dragging = false)}
  ondrop={e => { e.preventDefault(); dragging = false; handle(e.dataTransfer?.files ?? null); }}
  onclick={() => document.getElementById('filepick')?.click()}
  onkeydown={e => e.key === 'Enter' && document.getElementById('filepick')?.click()}>
  <div style="font-size:40px">🗂️</div>
  <h2 style="margin:10px 0 4px">{busy ? 'Reading backups…' : 'Drop backups here'}</h2>
  <p style="color:#64748b;margin:0">.jwlibrary and .jwlplaylist files — or click to choose.<br>Nothing is uploaded; merging happens in your browser.</p>
  <input id="filepick" type="file" multiple accept=".jwlibrary,.jwlplaylist" style="display:none"
    onchange={e => handle((e.target as HTMLInputElement).files)} />
</div>

{#each $loadErrors as err (err)}
  <div style="margin-top:12px;background:rgba(244,63,94,.12);border:1px solid rgba(244,63,94,.4);border-radius:12px;padding:12px 16px;color:#fda4af;font-size:13px">⚠️ {err}</div>
{/each}
