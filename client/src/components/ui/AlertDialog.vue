<script setup>
import Button from './Button.vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  confirmLabel: { type: String, default: 'Confirm' },
  cancelLabel: { type: String, default: 'Cancel' },
  destructive: { type: Boolean, default: false }
});

const emit = defineEmits(['update:open', 'confirm']);

function close() {
  emit('update:open', false);
}

function confirm() {
  emit('confirm');
}
</script>

<template>
  <Teleport to="body">
    <Transition name="alert">
      <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="close"></div>
        <div
          role="alertdialog"
          aria-modal="true"
          class="relative z-10 w-full max-w-sm rounded-lg border border-border bg-card p-5 shadow-xl"
        >
          <h3 class="text-base font-semibold">{{ title }}</h3>
          <p v-if="description" class="mt-2 text-sm text-muted-foreground">{{ description }}</p>
          <div class="mt-5 flex justify-end gap-2">
            <Button variant="outline" @click="close">{{ cancelLabel }}</Button>
            <Button :variant="destructive ? 'destructive' : 'default'" @click="confirm">
              {{ confirmLabel }}
            </Button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
