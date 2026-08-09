<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import AlertDialog from './ui/AlertDialog.vue';

const bridge = typeof window !== 'undefined' ? window.updateBridge : null;
const dialog = ref(null);
const version = ref('');
const offs = [];

function respond(choice) {
  if (bridge) {
    bridge.respond(choice);
  }
  dialog.value = null;
}

onMounted(() => {
  if (!bridge) {
    return;
  }
  offs.push(
    bridge.onUpdateAvailable((info) => {
      version.value = info.version;
      dialog.value = 'available';
    }),
    bridge.onUpdateDownloaded((info) => {
      version.value = info.version;
      dialog.value = 'downloaded';
    })
  );
});

onUnmounted(() => {
  for (const off of offs) {
    off();
  }
});
</script>

<template>
  <AlertDialog
    v-if="bridge"
    :open="dialog === 'available'"
    title="Update available"
    :description="`Version ${version} is available. Download it now?`"
    confirm-label="Download"
    cancel-label="Later"
    @confirm="respond('download')"
    @update:open="dialog = null"
  />
  <AlertDialog
    v-if="bridge"
    :open="dialog === 'downloaded'"
    title="Update ready"
    :description="`Version ${version} downloaded. Restart now to apply it?`"
    confirm-label="Restart now"
    cancel-label="Later"
    @confirm="respond('restart')"
    @update:open="dialog = null"
  />
</template>
