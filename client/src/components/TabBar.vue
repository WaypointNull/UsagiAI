<script setup>
import { X } from '@lucide/vue';

defineProps({
  tabs: { type: Array, required: true },
  activeKey: { type: String, default: null }
});

const emit = defineEmits(['select', 'close']);
</script>

<template>
  <div class="theme-transition flex items-stretch border-b border-border bg-card text-sm">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      type="button"
      class="group flex max-w-56 items-center gap-2 border-r border-border px-4 py-2 transition-colors"
      :class="tab.key === activeKey ? 'bg-accent text-accent-foreground' : 'bg-card text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'"
      @click="emit('select', tab.key)"
    >
      <span class="truncate">{{ tab.label }}</span>
      <X
        v-if="tabs.length > 1"
        :size="14"
        class="shrink-0 text-muted-foreground hover:text-foreground"
        @click.stop="emit('close', tab.key)"
      />
    </button>
    <div class="ml-auto flex items-center px-2">
      <button
        v-if="tabs.length === 1"
        type="button"
        class="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        title="Close"
        @click="emit('close', activeKey)"
      >
        <X :size="14" />
      </button>
    </div>
  </div>
</template>
