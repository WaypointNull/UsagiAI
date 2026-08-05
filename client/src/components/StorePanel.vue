<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import { renderMarkdown } from '../lib/markdown';
import { setActivity, clearActivity } from '../lib/activity';
import Button from './ui/Button.vue';
import Badge from './ui/Badge.vue';
import AlertDialog from './ui/AlertDialog.vue';
import { RefreshCw, Trash2, Wrench } from '@lucide/vue';

const emit = defineEmits(['installed']);

const repos = ref([]);
const detail = ref(null);
const selectedRepo = ref(null);
const selectedTag = ref(null);
const busyKey = ref(null);
const error = ref('');

const installed = computed(() => Boolean(detail.value && detail.value.installed));
const installedVersion = computed(() => (detail.value ? detail.value.installedVersion : null));
const latest = computed(() => (detail.value ? detail.value.latest : null));
const updateAvailable = computed(() => Boolean(detail.value && detail.value.updateAvailable));
const unavailable = computed(() => (detail.value && detail.value.unavailable ? detail.value.unavailable : null));

function parseVersion(value) {
  return String(value)
    .replace(/^v/i, '')
    .split(/[.\-+]/)
    .map((x) => (x === '' || isNaN(Number(x)) ? x : Number(x)));
}

function compareVersions(a, b) {
  const A = parseVersion(a);
  const B = parseVersion(b);
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i += 1) {
    const x = A[i] === undefined ? 0 : A[i];
    const y = B[i] === undefined ? 0 : B[i];
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) {
        return x < y ? -1 : 1;
      }
    } else {
      const xs = String(x);
      const ys = String(y);
      if (xs !== ys) {
        return xs < ys ? -1 : 1;
      }
    }
  }
  return 0;
}

const selectedRelease = computed(() =>
  detail.value && selectedTag.value
    ? (detail.value.releases || []).find((r) => r.tag === selectedTag.value) || null
    : null
);

const selectionUnavailable = computed(() =>
  Boolean(selectedRelease.value && selectedRelease.value.compatible === false)
);

const unavailableReason = computed(() => {
  if (!unavailable.value) {
    return '';
  }
  if (unavailable.value.reason === 'compatibility') {
    return 'Created before UsagiAI';
  }
  return unavailable.value.reason;
});

const readmeBaseUrl = computed(() => {
  if (!detail.value || !detail.value.latest) {
    return null;
  }
  return `/api/repos/${detail.value.owner}/${detail.value.repo}/raw/${encodeURIComponent(detail.value.latest)}/`;
});

const renderedReadme = computed(() =>
  renderMarkdown(detail.value && detail.value.readme ? detail.value.readme : 'No README found.', { baseUrl: readmeBaseUrl.value })
);

const actionLabel = computed(() => {
  if (!detail.value) {
    return '';
  }
  if (busyKey.value !== null) {
    return 'Working…';
  }
  if (unavailable.value || selectionUnavailable.value) {
    return 'Unavailable';
  }
  const target = selectedTag.value || latest.value || 'latest';
  if (!installed.value) {
    return selectedTag.value ? `Install ${target}` : 'Install';
  }
  const cmp = compareVersions(target, installedVersion.value);
  if (cmp === 0) {
    return 'Latest version installed';
  }
  if (cmp > 0) {
    return selectedTag.value ? `Update to ${target}` : 'Update to latest';
  }
  return selectedTag.value ? `Downgrade to ${target}` : 'Downgrade to latest';
});

const actionDisabled = computed(
  () =>
    busyKey.value !== null ||
    Boolean(unavailable.value) ||
    selectionUnavailable.value ||
    actionLabel.value === 'Latest version installed'
);

function renderNotes(markdown) {
  return renderMarkdown(markdown || '', { baseUrl: readmeBaseUrl.value });
}

async function loadList() {
  try {
    const data = await api.repos();
    repos.value = data.repos || [];
    if (repos.value.length) {
      await selectRepo(repos.value[0].owner, repos.value[0].repo);
    } else {
      detail.value = null;
    }
  } catch (e) {
    error.value = e.message;
  }
}

async function selectRepo(owner, repo) {
  selectedRepo.value = `${owner}/${repo}`;
  detail.value = null;
  selectedTag.value = null;
  try {
    const data = await api.repo(owner, repo);
    detail.value = data.repo;
  } catch (e) {
    error.value = e.message;
  }
}

function progressFor(key) {
  return (message, progress) => setActivity(key, message, progress);
}

async function runAction(key, label, fn) {
  if (busyKey.value) {
    return;
  }
  busyKey.value = key;
  error.value = '';
  setActivity(key, label);
  try {
    await fn();
    emit('installed');
    await loadList();
  } catch (e) {
    error.value = e.message;
  } finally {
    busyKey.value = null;
    clearActivity(key);
  }
}

async function install() {
  if (!detail.value) {
    return;
  }
  const key = selectedRepo.value;
  await runAction(key, installed.value ? 'Updating plugin…' : 'Installing plugin…', async () => {
    const [owner, repo] = selectedRepo.value.split('/');
    if (installed.value) {
      await api.updateRepo(owner, repo, selectedTag.value, progressFor(key));
    } else {
      await api.installRepo(owner, repo, selectedTag.value, progressFor(key));
    }
  });
}

async function quickUpdate(owner, repo) {
  const key = `${owner}/${repo}:update`;
  await runAction(key, `Updating ${repo}…`, () => api.updateRepo(owner, repo, undefined, progressFor(key)));
}

async function repair(owner, repo) {
  const key = `${owner}/${repo}:repair`;
  await runAction(key, `Repairing ${repo}…`, () => api.repairRepo(owner, repo, progressFor(key)));
}

const uninstallTarget = ref(null);
const uninstallOpen = ref(false);

function requestUninstall(owner, repo) {
  uninstallTarget.value = { owner, repo };
  uninstallOpen.value = true;
}

async function confirmUninstall() {
  const target = uninstallTarget.value;
  uninstallOpen.value = false;
  if (!target) {
    return;
  }
  const key = `${target.owner}/${target.repo}:uninstall`;
  await runAction(key, `Uninstalling ${target.repo}…`, () =>
    api.uninstallRepo(target.owner, target.repo, progressFor(key))
  );
}

function isRepoBusy(owner, repo) {
  return busyKey.value !== null && busyKey.value.startsWith(`${owner}/${repo}`);
}

function formatDate(iso) {
  if (!iso) {
    return '';
  }
  return new Date(iso).toLocaleDateString();
}

onMounted(loadList);
</script>

<template>
  <main class="flex min-w-0 min-h-0 flex-1 flex-col">
    <div class="flex min-h-0 flex-1">
      <aside class="flex w-60 shrink-0 flex-col border-r border-border bg-card">
        <div class="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Store
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto p-2">
          <div
            v-for="r in repos"
            :key="`${r.owner}/${r.repo}`"
            class="mb-1 rounded-md border p-2 text-sm transition-colors"
            :class="`${r.owner}/${r.repo}` === selectedRepo ? 'border-ring bg-accent' : 'border-border bg-background'"
          >
            <div class="flex cursor-pointer items-center gap-2" @click="selectRepo(r.owner, r.repo)">
              <span class="min-w-0 flex-1 truncate font-medium">{{ r.repo }}</span>
              <Badge v-if="r.installed" variant="secondary" class="shrink-0">{{ r.installedVersion }}</Badge>
            </div>
            <div v-if="r.installed" class="mt-1.5 flex items-center gap-1 border-t border-border pt-1.5">
              <button
                v-if="r.updateAvailable"
                class="flex h-6 flex-1 cursor-pointer items-center justify-center gap-1 rounded border border-border bg-background text-xs text-muted-foreground transition-all duration-150 hover:bg-accent hover:text-accent-foreground active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
                :disabled="isRepoBusy(r.owner, r.repo)"
                title="Quick update to latest"
                @click.stop="quickUpdate(r.owner, r.repo)"
              >
                <RefreshCw :size="12" />
                Update
              </button>
              <button
                class="flex h-6 flex-1 cursor-pointer items-center justify-center gap-1 rounded border border-border bg-background text-xs text-muted-foreground transition-all duration-150 hover:bg-accent hover:text-accent-foreground active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
                :disabled="isRepoBusy(r.owner, r.repo)"
                title="Repair (reinstall current version)"
                @click.stop="repair(r.owner, r.repo)"
              >
                <Wrench :size="12" />
                Repair
              </button>
              <button
                class="flex h-6 flex-1 cursor-pointer items-center justify-center gap-1 rounded border border-border bg-background text-xs text-muted-foreground transition-all duration-150 hover:bg-destructive hover:text-destructive-foreground active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
                :disabled="isRepoBusy(r.owner, r.repo)"
                title="Uninstall"
                @click.stop="requestUninstall(r.owner, r.repo)"
              >
                <Trash2 :size="12" />
                Uninstall
              </button>
            </div>
          </div>
          <div v-if="repos.length === 0" class="px-1 text-xs text-muted-foreground">
            No repos configured.
          </div>
        </div>
      </aside>

      <div v-if="detail" class="flex min-w-0 min-h-0 flex-1">
        <div class="flex min-w-0 flex-1 flex-col">
          <div class="flex items-center gap-3 border-b border-border px-6 py-4">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <h2 class="truncate text-base font-semibold">{{ detail.owner }}/{{ detail.repo }}</h2>
                <Badge v-if="detail.pluginName" variant="secondary">{{ detail.pluginName }}</Badge>
                <Badge v-if="updateAvailable" variant="default">update available</Badge>
              </div>
              <div class="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span v-if="installedVersion">installed {{ installedVersion }}</span>
                <span v-if="latest">latest {{ latest }}</span>
                <span v-if="detail.duplicateFolders.length" class="text-destructive">
                  duplicate plugin ids in: {{ detail.duplicateFolders.join(', ') }}
                </span>
              </div>
              <div v-if="unavailable" class="mt-1 text-xs text-destructive">
                Unavailable: {{ unavailableReason }}
                <span v-if="unavailable.message && unavailable.message !== unavailableReason"> — {{ unavailable.message }}</span>
              </div>
            </div>
            <Button
              class="ml-auto shrink-0"
              :disabled="actionDisabled"
              :title="selectionUnavailable ? 'Created before UsagiAI' : unavailable ? unavailable.message : ''"
              @click="install"
            >
              {{ actionLabel }}
            </Button>
          </div>

          <div class="markdown min-h-0 flex-1 overflow-y-auto p-6" v-html="renderedReadme"></div>

          <div v-if="error" class="border-t border-border px-6 py-2 text-xs text-destructive">
            {{ error }}
          </div>
        </div>

        <aside class="flex w-80 shrink-0 flex-col border-l border-border bg-card">
          <div class="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Releases
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto p-3">
            <div
              v-for="release in detail.releases"
              :key="release.tag"
              class="mb-2 cursor-pointer rounded-md border p-3 text-sm transition-colors"
              :class="release.tag === selectedTag ? 'border-ring bg-accent' : 'border-border bg-background hover:bg-accent/50'"
              @click="selectedTag = release.tag"
            >
              <div class="flex items-center gap-2">
                <span class="font-mono text-xs font-semibold">{{ release.tag }}</span>
                <Badge v-if="release.compatible === false" variant="secondary" class="ml-auto shrink-0">Unavailable</Badge>
                <span v-else class="ml-auto text-xs text-muted-foreground">{{ formatDate(release.publishedAt) }}</span>
              </div>
              <div v-if="release.compatible === false" class="mt-1 text-xs text-destructive">
                Unavailable: Created before UsagiAI
              </div>
              <div v-if="release.name" class="mt-1 truncate text-xs text-muted-foreground">{{ release.name }}</div>
              <details v-if="release.body" class="mt-2">
                <summary class="cursor-pointer text-xs text-muted-foreground">Notes</summary>
                <div class="markdown mt-2 text-xs" v-html="renderNotes(release.body)"></div>
              </details>
            </div>
            <div v-if="detail.releases.length === 0" class="px-1 text-xs text-muted-foreground">
              No releases yet.
            </div>
          </div>
        </aside>
      </div>

      <div v-else class="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading…</div>
    </div>
    <AlertDialog
      v-model:open="uninstallOpen"
      :title="`Uninstall ${uninstallTarget ? uninstallTarget.repo : ''}?`"
      description="The plugin files will be removed and the plugin will be closed."
      confirm-label="Uninstall"
      destructive
      @confirm="confirmUninstall"
    />
  </main>
</template>
