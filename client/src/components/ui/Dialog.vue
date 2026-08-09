<script setup>
import { X } from '@lucide/vue';

defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  description: { type: String, default: '' }
});

const emit = defineEmits(['update:open']);

function close() {
  emit('update:open', false);
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      role="dialog"
      aria-modal="true"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      @keydown.esc="close"
    >
      <div class="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm" @click="close"></div>
      <div
        class="animate-scale-in relative z-10 flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl"
      >
        <div class="flex items-start justify-between gap-4 border-b p-5">
          <div class="min-w-0">
            <h3 class="truncate text-base font-semibold">{{ title }}</h3>
            <p v-if="description" class="mt-1 text-sm text-muted-foreground">{{ description }}</p>
          </div>
          <button
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-[0.98]"
            aria-label="Close"
            @click="close"
          >
            <X class="h-4 w-4" />
          </button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto p-5">
          <slot />
        </div>
        <div v-if="$slots.footer" class="flex items-center justify-end gap-2 border-t p-4">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
