<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { api } from '../api';
import Badge from './ui/Badge.vue';
import Button from './ui/Button.vue';
import Dialog from './ui/Dialog.vue';
import AlertDialog from './ui/AlertDialog.vue';
import { Trash2, History } from '@lucide/vue';

const folders = ref([]);
const selected = ref(null);
const detailOpen = ref(false);
const confirm = ref(null);
const confirmOpen = ref(false);
let timer = null;

async function refresh() {
  try {
    const data = await api.history();
    folders.value = data.folders || [];
    if (selected.value) {
      const next = (data.folders || []).find((f) => f.folderId === selected.value.folderId);
      if (next) {
        selected.value = next;
      } else {
        selected.value = null;
        detailOpen.value = false;
      }
    }
  } catch {
    // hub not reachable yet
  }
}

function formatTime(iso) {
  return iso ? new Date(iso).toLocaleString() : '';
}

function openFolder(folder) {
  selected.value = folder;
  detailOpen.value = true;
}

const STAGE_ORDER = ['tag-list@1', 'weighted-tag-list@1'];
const STAGE_LABELS = { 'tag-list@1': 'Tag list', 'weighted-tag-list@1': 'Weighted tag list' };

const selectedStages = computed(() => {
  if (!selected.value) {
    return [];
  }
  return STAGE_ORDER.map((schema) => ({
    schema,
    label: STAGE_LABELS[schema],
    records: (selected.value.records || []).filter((r) => r.schema === schema)
  })).filter((stage) => stage.records.length > 0);
});

const selectedImages = computed(() =>
  (selected.value ? selected.value.records : []).filter((r) => r.schema === 'image@1' && r.output && r.output.image)
);

function stageBadges(folder) {
  const badges = [];
  if (folder.records.some((r) => r.schema === 'tag-list@1')) badges.push('Tags');
  if (folder.records.some((r) => r.schema === 'weighted-tag-list@1')) badges.push('Weighted');
  if (folder.records.some((r) => r.schema === 'image@1')) badges.push('Images');
  return badges;
}

function requestDeleteRecord(record) {
  confirm.value = {
    kind: 'record',
    record,
    title: 'Delete record?',
    description: `Delete this ${record.schema} record from ${formatTime(record.createdAt)}? This cannot be undone.`
  };
  confirmOpen.value = true;
}

function requestDeleteFolder() {
  if (!selected.value) {
    return;
  }
  confirm.value = {
    kind: 'folder',
    title: 'Delete folder?',
    description: `Delete this folder and all ${selected.value.records.length} linked record(s)? This cannot be undone.`
  };
  confirmOpen.value = true;
}

async function confirmAction() {
  const target = confirm.value;
  confirmOpen.value = false;
  if (!target) {
    return;
  }
  try {
    if (target.kind === 'record') {
      await api.deleteHistory(target.record.plugin, target.record.schema, target.record.id);
    } else if (selected.value) {
      await api.deleteFolder(selected.value.folderId);
      detailOpen.value = false;
      selected.value = null;
    }
  } catch (e) {
    window.alert(e.message);
  }
  refresh();
}

onMounted(() => {
  refresh();
  timer = setInterval(refresh, 5000);
});

onUnmounted(() => clearInterval(timer));
</script>

<template>
  <main class="flex min-w-0 min-h-0 flex-1 flex-col">
    <div class="min-h-0 flex-1 overflow-y-auto p-4">
      <div v-if="folders.length === 0" class="text-sm text-muted-foreground">No history yet.</div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <button
          v-for="folder in folders"
          :key="folder.folderId"
          class="group overflow-hidden rounded-lg border border-border bg-background text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-ring/50 hover:shadow-md"
          @click="openFolder(folder)"
        >
          <div class="flex h-32 items-center justify-center overflow-hidden border-b border-border bg-muted/30 px-3">
            <img v-if="folder.thumb" :src="folder.thumb" alt="" class="h-full w-full object-cover" />
            <p v-else-if="folder.label" class="line-clamp-4 text-center text-sm text-muted-foreground">
              {{ folder.label }}
            </p>
            <div v-else class="flex flex-col items-center gap-1 text-muted-foreground/60">
              <History class="h-6 w-6" />
              <span class="text-xs">Untitled</span>
            </div>
          </div>
          <div class="p-3">
            <p class="truncate text-sm font-medium">{{ folder.label || 'Untitled' }}</p>
            <div class="mt-1.5 flex items-center justify-between gap-2">
              <span class="text-xs text-muted-foreground">{{ formatTime(folder.updatedAt) }}</span>
              <span v-if="stageBadges(folder).length" class="flex gap-1">
                <Badge v-for="badge in stageBadges(folder)" :key="badge" variant="outline" class="rounded-md text-[10px]">
                  {{ badge }}
                </Badge>
              </span>
            </div>
          </div>
        </button>
      </div>
    </div>

    <Dialog
      v-model:open="detailOpen"
      :title="selected ? (selected.label || 'Untitled') : ''"
      :description="selected ? formatTime(selected.updatedAt) : ''"
    >
      <template v-if="selected">
        <div v-if="selected.label" class="mb-4 space-y-1">
          <p class="text-xs font-medium text-muted-foreground">Prompt</p>
          <p class="whitespace-pre-wrap text-sm text-foreground">{{ selected.label }}</p>
        </div>

        <div class="space-y-2">
          <details
            v-for="(stage, i) in selectedStages"
            :key="stage.schema"
            :open="i === selectedStages.length - 1"
            class="rounded-md border border-border"
          >
            <summary class="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
              {{ stage.label }} · {{ stage.records.length }} record{{ stage.records.length === 1 ? '' : 's' }}
            </summary>
            <div class="space-y-3 border-t border-border p-3">
              <article v-for="record in stage.records" :key="record.id" class="rounded-md border border-border/60 bg-muted/20 p-3">
                <div class="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{{ record.pluginName }} · {{ formatTime(record.createdAt) }}</span>
                  <button
                    class="ml-auto flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 transition-all duration-150 hover:border-destructive hover:text-destructive active:scale-[0.97]"
                    title="Delete record"
                    @click="requestDeleteRecord(record)"
                  >
                    <Trash2 :size="12" />
                  </button>
                </div>

                <template v-if="stage.schema === 'tag-list@1'">
                  <div v-if="record.input && record.input.naturalLanguage" class="mb-2 text-sm">
                    <span class="mr-2 text-muted-foreground">Prompt:</span>
                    <span class="text-foreground">{{ record.input.naturalLanguage }}</span>
                  </div>
                  <div v-if="record.output && record.output.positiveTags && record.output.positiveTags.length" class="mb-2 flex flex-wrap items-center gap-1.5">
                    <span class="mr-1 text-xs text-muted-foreground">Positive</span>
                    <Badge v-for="tag in record.output.positiveTags" :key="tag" variant="outline" class="rounded-md">
                      {{ tag }}
                    </Badge>
                  </div>
                  <div v-if="record.output && record.output.negativeTags && record.output.negativeTags.length" class="flex flex-wrap items-center gap-1.5">
                    <span class="mr-1 text-xs text-muted-foreground">Negative</span>
                    <Badge v-for="tag in record.output.negativeTags" :key="tag" variant="outline" class="rounded-md text-destructive">
                      {{ tag }}
                    </Badge>
                  </div>
                  <pre v-if="record.output && record.output.finalText" class="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-2 font-mono text-xs leading-relaxed">
                    {{ record.output.finalText }}
                  </pre>
                </template>

                <template v-else>
                  <div v-if="record.output && record.output.entries && record.output.entries.length" class="flex flex-wrap gap-1.5">
                    <Badge v-for="entry in record.output.entries" :key="entry.name" variant="outline" class="rounded-md">
                      {{ entry.name }}<span v-if="entry.strength !== undefined && entry.strength !== 1">:{{ entry.strength }}</span>
                    </Badge>
                  </div>
                  <pre v-if="record.output && record.output.finalText" class="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-2 font-mono text-xs leading-relaxed">
                    {{ record.output.finalText }}
                  </pre>
                </template>
              </article>
            </div>
          </details>
        </div>

        <div v-if="selectedImages.length" class="mt-4">
          <p class="mb-2 text-xs font-medium text-muted-foreground">Images</p>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <img
              v-for="(record, idx) in selectedImages"
              :key="idx"
              :src="record.output.image"
              alt=""
              class="aspect-square w-full rounded-md border border-border object-cover"
            />
          </div>
        </div>
      </template>

      <template #footer>
        <Button variant="outline" size="sm" @click="detailOpen = false">Close</Button>
        <Button variant="destructive" size="sm" @click="requestDeleteFolder">
          <Trash2 class="h-4 w-4" />
          Delete folder
        </Button>
      </template>
    </Dialog>

    <AlertDialog
      v-model:open="confirmOpen"
      :title="confirm ? confirm.title : ''"
      :description="confirm ? confirm.description : ''"
      confirm-label="Delete"
      destructive
      @confirm="confirmAction"
    />
  </main>
</template>
