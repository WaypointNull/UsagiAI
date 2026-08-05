<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { api } from '../api';
import Badge from './ui/Badge.vue';
import AlertDialog from './ui/AlertDialog.vue';
import { Trash2 } from '@lucide/vue';

const plugins = ref([]);
let timer = null;

const confirm = ref(null);
const confirmOpen = ref(false);

async function refresh() {
  try {
    const data = await api.history();
    plugins.value = data.history || [];
  } catch {
    // hub not reachable yet
  }
}

function formatTime(iso) {
  return new Date(iso).toLocaleString();
}

function requestDeleteRecord(plugin, schema, record) {
  confirm.value = {
    kind: 'record',
    plugin,
    schema,
    record,
    title: 'Delete record?',
    description: `Delete this ${schema} record from ${formatTime(record.createdAt)}? This cannot be undone.`
  };
  confirmOpen.value = true;
}

function requestClearSchema(plugin, schema, name) {
  confirm.value = {
    kind: 'schema',
    plugin,
    schema,
    title: 'Clear schema?',
    description: `Delete ALL ${schema} records for ${name}? This cannot be undone.`
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
      await api.deleteHistory(target.plugin, target.schema, target.record.id);
    } else {
      await api.clearHistory(target.plugin, target.schema);
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
      <div v-if="plugins.length === 0" class="text-sm text-muted-foreground">No history yet.</div>

      <section v-for="plugin in plugins" :key="plugin.plugin" class="mb-8 last:mb-0">
        <h2 class="mb-3 text-sm font-semibold">{{ plugin.name }}</h2>

        <div v-if="!plugin.schemas.length" class="text-xs text-muted-foreground">No records.</div>

        <div v-for="schemaEntry in plugin.schemas" :key="schemaEntry.schema" class="mb-4">
          <div class="mb-2 flex items-center gap-2">
            <span class="text-xs font-medium text-muted-foreground">{{ schemaEntry.schema }}</span>
            <span v-if="schemaEntry.records.length" class="text-xs text-muted-foreground/60">
              {{ schemaEntry.records.length }} record{{ schemaEntry.records.length === 1 ? '' : 's' }}
            </span>
            <button
              v-if="schemaEntry.records.length"
              class="ml-auto flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground transition-all duration-150 hover:bg-destructive hover:text-destructive-foreground active:scale-[0.97]"
              title="Clear all records in this schema"
              @click="requestClearSchema(plugin.plugin, schemaEntry.schema, plugin.name)"
            >
              <Trash2 :size="12" />
              Clear
            </button>
          </div>

          <article
            v-for="record in schemaEntry.records"
            :key="record.id"
            class="mb-3 rounded-md border border-border bg-background p-3 transition-colors hover:border-ring/50"
          >
            <div class="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
              <span>{{ formatTime(record.createdAt) }}</span>
              <button
                class="ml-auto flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 transition-all duration-150 hover:border-destructive hover:text-destructive active:scale-[0.97]"
                title="Delete record"
                @click="requestDeleteRecord(plugin.plugin, schemaEntry.schema, record)"
              >
                <Trash2 :size="12" />
              </button>
            </div>

            <template v-if="record.schema === 'tag-list@1'">
              <div class="mb-2 text-sm">
                <span class="mr-2 text-muted-foreground">Prompt:</span>
                <span class="text-foreground">{{ record.input.naturalLanguage }}</span>
              </div>
              <div v-if="record.input.loraInput" class="mb-2 text-sm">
                <span class="mr-2 text-muted-foreground">LoRA:</span>
                <span class="text-foreground">{{ record.input.loraInput }}</span>
              </div>
              <div v-if="record.output.positiveTags && record.output.positiveTags.length" class="mb-2 flex flex-wrap items-center gap-1.5">
                <span class="mr-1 text-xs text-muted-foreground">Positive</span>
                <Badge v-for="tag in record.output.positiveTags" :key="tag" variant="outline" class="rounded-md">
                  {{ tag }}
                </Badge>
              </div>
              <div v-if="record.output.negativeTags && record.output.negativeTags.length" class="flex flex-wrap items-center gap-1.5">
                <span class="mr-1 text-xs text-muted-foreground">Negative</span>
                <Badge v-for="tag in record.output.negativeTags" :key="tag" variant="outline" class="rounded-md text-destructive">
                  {{ tag }}
                </Badge>
              </div>
              <details v-if="record.output.finalText" class="mt-3">
                <summary class="cursor-pointer select-none text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                  Output (plaintext)
                </summary>
                <pre class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed">{{ record.output.finalText }}</pre>
              </details>
            </template>

            <details v-else>
              <summary class="cursor-pointer select-none text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                Record
              </summary>
              <pre class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/50 p-3 font-mono text-xs">{{ record }}</pre>
            </details>
          </article>
        </div>
      </section>
    </div>
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
