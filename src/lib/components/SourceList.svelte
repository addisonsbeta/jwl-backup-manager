<script lang="ts">
  import { sources, removeSource, toggleInclude } from '../stores';
</script>

{#if $sources.length}
  <h3 style="margin:26px 0 10px">Loaded sources</h3>
  {#each $sources as s (s.fileName)}
    <div class="card" style="display:flex;align-items:center;gap:14px;padding:14px 18px;margin-bottom:10px;opacity:{s.included ? 1 : .45}">
      <span style="font-size:22px">{s.ud.meta.type === 1 ? '🎬' : '📦'}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;color:#f1f5f9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{s.fileName}</div>
        <div style="font-size:12px;color:#64748b">
          {s.ud.meta.deviceName} · schema v{s.ud.meta.schemaVersion} · {s.ud.notes.size} notes · {s.ud.marks.size} highlights · {s.ud.playlistItems.size} playlist items
        </div>
        {#each s.ud.meta.warnings as w (w)}<div style="font-size:12px;color:#fbbf24">⚠️ {w}</div>{/each}
      </div>
      <label style="font-size:12px;color:#94a3b8;display:flex;gap:6px;align-items:center;cursor:pointer">
        <input type="checkbox" checked={s.included} onchange={() => toggleInclude(s.fileName)} /> include
      </label>
      <button class="ghost" onclick={() => removeSource(s.fileName)}>✕</button>
    </div>
  {/each}
{/if}
