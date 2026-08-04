<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { api } from './api';
import { applyTheme, DEFAULT_THEME } from './theme';
import PluginList from './components/PluginList.vue';
import PluginFrame from './components/PluginFrame.vue';
import HistoryPanel from './components/HistoryPanel.vue';
import TabBar from './components/TabBar.vue';

const plugins = ref([]);
const tabs = ref([]);
const activeKey = ref(null);
let timer = null;

const activeTheme = computed(() => {
  if (activeKey.value === 'history') {
    return DEFAULT_THEME;
  }
  const tab = tabs.value.find((t) => t.key === activeKey.value);
  if (tab && tab.kind === 'plugin') {
    const plugin = plugins.value.find((p) => p.id === tab.id);
    if (plugin && plugin.theme && plugin.theme.tokens) {
      return plugin.theme.tokens;
    }
  }
  return DEFAULT_THEME;
});

watch(activeTheme, (tokens) => applyTheme(tokens), { immediate: true });

const activePluginId = computed(() => {
  const tab = tabs.value.find((t) => t.key === activeKey.value);
  return tab && tab.kind === 'plugin' ? tab.id : null;
});

const pluginTabs = computed(() => tabs.value.filter((t) => t.kind === 'plugin'));

const historyTabOpen = computed(() => tabs.value.some((t) => t.kind === 'history'));

async function refresh() {
  try {
    const data = await api.plugins();
    plugins.value = data.plugins;
    for (const tab of [...tabs.value]) {
      if (tab.kind === 'plugin') {
        const plugin = data.plugins.find((p) => p.id === tab.id);
        if (!plugin || plugin.status !== 'running') {
          closeTab(tab.key);
        }
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
      closeTab(`plugin:${plugin.id}`);
    } else {
      const data = await api.start(plugin.id);
      if (data.plugin && data.plugin.status === 'running') {
        openPluginTab(data.plugin);
      }
    }
  } finally {
    refresh();
  }
}

function show(plugin) {
  if (plugin.status === 'running') {
    openPluginTab(plugin);
  }
}

function openPluginTab(plugin) {
  const key = `plugin:${plugin.id}`;
  const existing = tabs.value.find((t) => t.key === key);
  if (existing) {
    activeKey.value = key;
    return;
  }
  tabs.value.push({ key, kind: 'plugin', id: plugin.id, label: plugin.name, url: plugin.url });
  activeKey.value = key;
}

function openHistory() {
  const existing = tabs.value.find((t) => t.key === 'history');
  if (existing) {
    activeKey.value = 'history';
    return;
  }
  tabs.value.push({ key: 'history', kind: 'history', label: 'History' });
  activeKey.value = 'history';
}

function selectTab(key) {
  activeKey.value = key;
}

function closeTab(key) {
  const idx = tabs.value.findIndex((t) => t.key === key);
  if (idx === -1) {
    return;
  }
  const wasActive = activeKey.value === key;
  tabs.value.splice(idx, 1);
  if (wasActive) {
    activeKey.value = tabs.value.length ? tabs.value[Math.min(idx, tabs.value.length - 1)].key : null;
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
    <PluginList
      :plugins="plugins"
      :active-id="activePluginId"
      :history-active="activeKey === 'history'"
      @toggle="toggle"
      @show="show"
      @history="openHistory"
    />
    <div class="flex min-w-0 min-h-0 flex-1 flex-col">
      <TabBar v-if="tabs.length" :tabs="tabs" :active-key="activeKey" @select="selectTab" @close="closeTab" />
      <template v-if="tabs.length">
        <PluginFrame
          v-for="tab in pluginTabs"
          :key="tab.key"
          v-show="tab.key === activeKey"
          :plugin="tab"
        />
        <HistoryPanel v-if="historyTabOpen" v-show="activeKey === 'history'" />
      </template>
      <div v-else class="theme-transition flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Select a tool from the sidebar.
      </div>
    </div>
  </div>
</template>
