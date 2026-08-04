<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { api } from './api';
import { applyTheme, DEFAULT_THEME } from './theme';
import PluginList from './components/PluginList.vue';
import PluginFrame from './components/PluginFrame.vue';

const plugins = ref([]);
const active = ref(null);
let timer = null;

const activeTheme = computed(() => {
  const plugin = plugins.value.find((p) => p.id === active.value?.id);
  return (plugin && plugin.theme && plugin.theme.tokens) || DEFAULT_THEME;
});

watch(activeTheme, (tokens) => applyTheme(tokens), { immediate: true });

async function refresh() {
  try {
    const data = await api.plugins();
    plugins.value = data.plugins;
    if (active.value) {
      const still = data.plugins.find((p) => p.id === active.value.id);
      if (!still || still.status !== 'running') {
        active.value = null;
      }
    }
  } catch {
    // hub not reachable yet
  }
}

async function toggle(plugin) {
  try {
    if (plugin.status === 'running') {
      await api.stop(plugin.id);
      if (active.value && active.value.id === plugin.id) {
        active.value = null;
      }
    } else {
      const data = await api.start(plugin.id);
      if (data.plugin && data.plugin.status === 'running') {
        active.value = { id: data.plugin.id, name: data.plugin.name, url: data.plugin.url };
      }
    }
  } finally {
    refresh();
  }
}

function show(plugin) {
  if (plugin.status === 'running') {
    active.value = { id: plugin.id, name: plugin.name, url: plugin.url };
  }
}

onMounted(() => {
  refresh();
  timer = setInterval(refresh, 5000);
});

onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div class="flex h-screen w-screen overflow-hidden">
    <PluginList :plugins="plugins" :active-id="active && active.id" @toggle="toggle" @show="show" />
    <PluginFrame v-if="active" :plugin="active" @close="active = null" />
    <div v-else class="theme-transition flex flex-1 items-center justify-center text-sm text-muted-foreground">
      Select a tool from the sidebar.
    </div>
  </div>
</template>
