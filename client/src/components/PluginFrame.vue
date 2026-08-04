<script setup>
import { X } from '@lucide/vue';

defineProps({
  plugin: { type: Object, required: true }
});

const emit = defineEmits(['close']);
</script>

<template>
  <main class="theme-transition flex min-w-0 flex-1 flex-col">
    <div class="theme-transition flex items-center gap-2 border-b border-border bg-card px-4 py-2 text-xs text-muted-foreground">
      <span class="font-medium text-foreground">{{ plugin.name }}</span>
      <span class="truncate">{{ plugin.url }}</span>
      <button
        type="button"
        class="ml-auto rounded-md p-1 transition-colors hover:bg-accent hover:text-accent-foreground"
        title="Close"
        @click="emit('close')"
      >
        <X :size="14" />
      </button>
    </div>
    <iframe :src="plugin.url" class="w-full flex-1 border-none bg-background" />
  </main>
</template>
