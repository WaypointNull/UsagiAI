<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { api } from './api';
import { applyTheme, DEFAULT_THEME } from './theme';
import { activity } from './lib/activity';
import PluginList from './components/PluginList.vue';
import PluginFrame from './components/PluginFrame.vue';
import HistoryPanel from './components/HistoryPanel.vue';
import StorePanel from './components/StorePanel.vue';
import TabBar from './components/TabBar.vue';

const plugins = ref([]);
const tabs = ref([]);
const activeKey = ref(null);
let timer = null;

const activeTheme = computed(() => {
  if (activeKey.value === 'history' || activeKey.value === 'store') {
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

const storeTabOpen = computed(() => tabs.value.some((t) => t.kind === 'store'));

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
    if (plugin.status === 'running' || plugin.status === 'starting') {
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

const runningCount = computed(() => plugins.value.filter((p) => p.status === 'running').length);

const statusActivity = computed(() => {
  if (activity.key) {
    return { label: activity.label, progress: activity.progress };
  }
  const starting = plugins.value.find((p) => p.status === 'starting');
  if (starting) {
    return { label: `Initializing ${starting.name}…`, progress: null };
  }
  return null;
});

const activeLabel = computed(() => {
  if (!activeKey.value) {
    return '';
  }
  if (activeKey.value === 'store') {
    return 'Store';
  }
  if (activeKey.value === 'history') {
    return 'History';
  }
  const tab = tabs.value.find((t) => t.key === activeKey.value);
  return tab ? tab.label : '';
});

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

function openStore() {
  const existing = tabs.value.find((t) => t.key === 'store');
  if (existing) {
    activeKey.value = 'store';
    return;
  }
  tabs.value.push({ key: 'store', kind: 'store', label: 'Store' });
  activeKey.value = 'store';
}

function selectTab(key) {
  activeKey.value = key;
}

function reorderTabs(from, to) {
  if (from === to || from < 0 || to < 0 || from >= tabs.value.length || to >= tabs.value.length) {
    return;
  }
  const [moved] = tabs.value.splice(from, 1);
  tabs.value.splice(to, 0, moved);
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
  <div class="flex h-screen w-screen flex-col overflow-hidden">
    <div class="flex min-h-0 flex-1 overflow-hidden">
      <PluginList
        :plugins="plugins"
        :active-id="activePluginId"
        :history-active="activeKey === 'history'"
        :store-active="activeKey === 'store'"
        @toggle="toggle"
        @show="show"
        @history="openHistory"
        @store="openStore"
      />
      <div class="flex min-w-0 min-h-0 flex-1 flex-col">
        <TabBar v-if="tabs.length" :tabs="tabs" :active-key="activeKey" @select="selectTab" @close="closeTab" @reorder="reorderTabs" />
        <template v-if="tabs.length">
          <PluginFrame
            v-for="tab in pluginTabs"
            :key="tab.key"
            v-show="tab.key === activeKey"
            :plugin="tab"
          />
          <HistoryPanel v-if="historyTabOpen" v-show="activeKey === 'history'" />
          <StorePanel v-if="storeTabOpen" v-show="activeKey === 'store'" @installed="refresh" />
        </template>
        <div v-else class="theme-transition flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Select a tool from the sidebar.
        </div>
      </div>
    </div>
    <footer class="flex h-7 shrink-0 items-center gap-3 border-t border-primary/40 bg-primary/15 px-3 text-xs font-medium text-foreground">
      <span class="font-semibold text-primary">UsagiAI</span>
      <template v-if="statusActivity">
        <span class="truncate">{{ statusActivity.label }}</span>
        <div class="h-1 w-36 shrink-0 overflow-hidden rounded-full bg-primary/25">
          <div
            v-if="statusActivity.progress !== null"
            class="h-full rounded-full bg-primary transition-[width] duration-300"
            :style="{ width: `${Math.max(4, statusActivity.progress * 100)}%` }"
          />
          <div v-else class="h-full w-2/5 rounded-full bg-primary animate-indeterminate" />
        </div>
      </template>
      <template v-else>
        <span>{{ runningCount }}/{{ plugins.length }} plugins running</span>
      </template>
      <span v-if="activeLabel" class="ml-auto truncate">{{ activeLabel }}</span>
    </footer>
  </div>
</template>
