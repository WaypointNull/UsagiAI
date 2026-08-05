<script setup>
import Button from './ui/Button.vue';
import Badge from './ui/Badge.vue';
import Separator from './ui/Separator.vue';
import { Bot, History, Loader2, Play, Square, Store } from '@lucide/vue';

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

function statusLabel(status) {
  if (status === 'starting') {
    return 'initializing';
  }
  return status;
}

function actionTitle(status) {
  if (status === 'running') {
    return 'Close';
  }
  if (status === 'starting') {
    return 'Interrupt';
  }
  return 'Open';
}
</script>

<template>
  <aside class="theme-transition flex w-64 shrink-0 flex-col border-r border-border bg-card">
    <div class="flex items-center gap-2 p-4 pb-3">
      <h1 class="text-lg font-semibold tracking-wide">UsagiAI</h1>
      <Badge class="ml-auto" variant="secondary">hub</Badge>
    </div>
    <Separator class="w-full bg-primary" />

    <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
      <div
        v-for="plugin in plugins"
        :key="plugin.id"
        class="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors"
        :class="plugin.id === activeId ? 'border-ring bg-accent' : 'border-border bg-background hover:bg-accent/50'"
        @click="emit('show', plugin)"
      >
        <img v-if="plugin.icon" :src="plugin.icon" alt="" class="h-4 w-4 shrink-0 rounded-sm object-contain" />
        <Bot v-else :size="16" class="shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate font-medium">{{ plugin.name }}</span>
        <Badge :variant="statusVariant(plugin.status)" class="capitalize">
          <Loader2 v-if="plugin.status === 'starting'" :size="12" class="animate-spin" />
          {{ statusLabel(plugin.status) }}
        </Badge>
        <Button
          size="icon"
          variant="ghost"
          class="h-7 w-7"
          :title="actionTitle(plugin.status)"
          @click.stop="emit('toggle', plugin)"
        >
          <Square v-if="plugin.status === 'running' || plugin.status === 'starting'" :size="14" />
          <Play v-else :size="14" />
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
