<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { api } from '../api';
import Badge from './ui/Badge.vue';

const plugins = ref([]);
let timer = null;

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
          <div v-if="schemaEntry.records.length" class="mb-2 text-xs text-muted-foreground">{{ schemaEntry.schema }}</div>

          <article v-for="record in schemaEntry.records" :key="record.id" class="mb-3 rounded-md border border-border bg-background p-3">
            <div class="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
              <span>{{ formatTime(record.createdAt) }}</span>
              <span class="ml-auto">{{ record.schema }}</span>
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
              <div class="mb-2 flex flex-wrap items-center gap-1.5">
                <span class="mr-1 text-xs text-muted-foreground">Positive</span>
                <Badge v-for="tag in record.output.positiveTags" :key="tag" variant="outline" class="rounded-md">
                  {{ tag }}
                </Badge>
              </div>
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="mr-1 text-xs text-muted-foreground">Negative</span>
                <Badge v-for="tag in record.output.negativeTags" :key="tag" variant="outline" class="rounded-md text-destructive">
                  {{ tag }}
                </Badge>
              </div>
              <pre
                v-if="record.output.finalText"
                class="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed"
              >{{ record.output.finalText }}</pre>
            </template>

            <pre v-else class="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/50 p-3 font-mono text-xs">{{ record }}</pre>
          </article>
        </div>
      </section>
    </div>
  </main>
</template>
