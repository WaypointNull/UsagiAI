<script setup>
import Button from './ui/Button.vue';
import Badge from './ui/Badge.vue';
import Separator from './ui/Separator.vue';
import { History, Play, Square, Store } from '@lucide/vue';

defineProps({
  plugins: { type: Array, default: () => [] },
  activeId: { type: String, default: null },
  historyActive: { type: Boolean, default: false },
  storeActive: { type: Boolean, default: false }
});

const emit = defineEmits(['toggle', 'show', 'history', 'store']);

function statusVariant(status) {
  if (status === 'running') {
    return 'default';
  }
  if (status === 'crashed') {
    return 'destructive';
  }
  return 'secondary';
}
</script>

<template>
  <aside class="theme-transition flex w-64 shrink-0 flex-col border-r border-border bg-card">
    <div class="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
      <div class="mb-1 flex items-center gap-2">
        <h1 class="text-lg font-semibold tracking-wide">UsagiAI</h1>
        <Badge class="ml-auto" variant="secondary">hub</Badge>
      </div>
      <Separator />

      <div
        v-for="plugin in plugins"
        :key="plugin.id"
        class="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors"
        :class="plugin.id === activeId ? 'border-ring bg-accent' : 'border-border bg-background hover:bg-accent/50'"
        @click="emit('show', plugin)"
      >
        <span class="min-w-0 flex-1 truncate font-medium">{{ plugin.name }}</span>
        <Badge :variant="statusVariant(plugin.status)" class="capitalize">{{ plugin.status }}</Badge>
        <Button size="icon" variant="ghost" class="h-7 w-7" :title="plugin.status === 'running' ? 'Close' : 'Open'" @click.stop="emit('toggle', plugin)">
          <Play v-if="plugin.status !== 'running'" :size="14" />
          <Square v-else :size="14" />
        </Button>
      </div>

      <div v-if="plugins.length === 0" class="px-1 text-xs text-muted-foreground">
        No plugins found. Drop a <code>plugin.json</code> folder into <code>plugins/</code>.
      </div>
    </div>

    <div class="border-t border-border p-4">
      <Button
        variant="ghost"
        class="w-full justify-start"
        :class="storeActive ? 'border border-ring bg-accent text-accent-foreground' : ''"
        @click="emit('store')"
      >
        <Store :size="16" />
        Store
      </Button>
      <Button
        variant="ghost"
        class="mt-1 w-full justify-start"
        :class="historyActive ? 'border border-ring bg-accent text-accent-foreground' : ''"
        @click="emit('history')"
      >
        <History :size="16" />
        History
      </Button>
    </div>
  </aside>
</template>
