<script setup>
defineProps({
  plugin: { type: Object, required: true }
});
</script>

<template>
  <main class="flex min-w-0 min-h-0 flex-1 flex-col">
    <iframe :src="plugin.url" class="w-full min-h-0 flex-1 border-none bg-background" />
  </main>
</template>
