<script lang="ts">
  import { phase, sources, unresolvedCount, type Phase } from './lib/stores';
  import DropZone from './lib/components/DropZone.svelte';
  import SourceList from './lib/components/SourceList.svelte';
  import MosaicDashboard from './lib/components/MosaicDashboard.svelte';
  import TimelineRiver from './lib/components/TimelineRiver.svelte';
  import DetailList from './lib/components/DetailList.svelte';
  import ConflictResolver from './lib/components/ConflictResolver.svelte';
  import ExportPanel from './lib/components/ExportPanel.svelte';

  const steps: { id: Phase; label: string }[] = [
    { id: 'ingest', label: '1 · Add backups' },
    { id: 'explore', label: '2 · Explore' },
    { id: 'resolve', label: '3 · Resolve' },
    { id: 'export', label: '4 · Export' },
  ];
</script>

<main style="max-width:1080px;margin:0 auto;padding:28px 20px 80px">
  <header style="display:flex;align-items:baseline;gap:14px;margin-bottom:6px;flex-wrap:wrap">
    <h1 style="font-size:26px;margin:0">JWL Backup Manager</h1>
    <span style="color:#64748b;font-size:13px">merge your JW Library backups — everything stays on this device</span>
  </header>

  <nav style="display:flex;gap:6px;margin:18px 0 26px;background:rgba(148,163,184,.1);border-radius:14px;padding:5px;width:fit-content">
    {#each steps as s (s.id)}
      <button class="ghost" style="border:none;{$phase === s.id ? 'background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff' : ''}"
        disabled={s.id !== 'ingest' && $sources.filter(x => x.included).length === 0}
        onclick={() => phase.set(s.id)}>
        {s.label}{#if s.id === 'resolve' && $unresolvedCount > 0}&nbsp;<span style="background:#f43f5e;color:#fff;border-radius:99px;padding:1px 8px;font-size:11px">{$unresolvedCount}</span>{/if}
      </button>
    {/each}
  </nav>

  {#if $phase === 'ingest'}
    <DropZone /><SourceList />
  {:else if $phase === 'explore'}
    <MosaicDashboard /><TimelineRiver /><DetailList />
  {:else if $phase === 'resolve'}
    <ConflictResolver />
  {:else}
    <ExportPanel />
  {/if}
</main>
