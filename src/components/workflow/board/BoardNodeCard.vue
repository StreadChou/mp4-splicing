<template>
  <q-card flat bordered class="board-node-card">
    <q-card-section class="q-pb-sm">
      <div class="text-subtitle2 text-weight-medium">{{ card.nodeLabel }}</div>
      <div class="text-caption text-grey-5">{{ card.nodeTypeLabel }} ({{ card.nodeType }})</div>
    </q-card-section>
    <q-separator />
    <q-card-section class="q-pt-sm">
      <template v-if="card.fields.length > 0">
        <div v-for="field in card.fields" :key="`${card.nodeId}-${field.key}`" class="q-mb-sm">
          <q-input
            v-if="field.kind === 'text' || field.kind === 'directory' || field.kind === 'video'"
            :disable="readonly"
            :label="field.label"
            :placeholder="field.placeholder"
            :model-value="readStringField(field)"
            outlined
            dense
            @update:model-value="writeStringField(field, $event)"
          >
            <template #append>
              <q-btn
                v-if="field.kind === 'directory'"
                flat
                round
                dense
                icon="folder_open"
                :disable="readonly"
                @click="emitPickPath(field.key, true)"
              />
              <q-btn
                v-else-if="field.kind === 'video'"
                flat
                round
                dense
                icon="movie"
                :disable="readonly"
                @click="emitPickPath(field.key, false)"
              />
            </template>
          </q-input>

          <q-input
            v-else-if="field.kind === 'textarea' || field.kind === 'json'"
            :disable="readonly"
            :label="field.label"
            :placeholder="field.placeholder"
            :model-value="readStringField(field)"
            type="textarea"
            autogrow
            outlined
            dense
            @update:model-value="writeStringField(field, $event)"
          />

          <q-input
            v-else-if="field.kind === 'number'"
            :disable="readonly"
            :label="field.label"
            :model-value="readNumberField(field)"
            :min="field.min"
            :max="field.max"
            :step="field.step || 1"
            type="number"
            outlined
            dense
            @update:model-value="writeNumberField(field, $event)"
          />

          <q-select
            v-else-if="field.kind === 'select'"
            :disable="readonly"
            :label="field.label"
            :model-value="readSelectField(field)"
            :options="field.options || []"
            option-label="label"
            option-value="value"
            emit-value
            map-options
            outlined
            dense
            @update:model-value="writeSelectField(field, $event)"
          />

          <q-checkbox
            v-else-if="field.kind === 'boolean'"
            :disable="readonly"
            :label="field.label"
            :model-value="readBooleanField(field)"
            color="primary"
            @update:model-value="writeBooleanField(field, $event)"
          />

          <div v-if="field.helpText" class="text-caption text-grey-5 q-mt-xs">{{ field.helpText }}</div>
        </div>
      </template>
      <div v-else class="text-caption text-grey-5">当前节点没有可编辑表单项</div>
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import type { BoardCard, BoardFieldSchema } from "./board-schema";

interface UpdateFieldEvent {
  nodeId: string;
  key: string;
  value: unknown;
}

interface PickPathEvent {
  nodeId: string;
  key: string;
  directory: boolean;
}

const props = defineProps<{
  card: BoardCard;
  config: Record<string, unknown>;
  readonly: boolean;
}>();

const emit = defineEmits<{
  "update-field": [payload: UpdateFieldEvent];
  "pick-path": [payload: PickPathEvent];
}>();

function readFieldRawValue(field: BoardFieldSchema): unknown {
  if (field.key in props.config) {
    return props.config[field.key];
  }
  return field.defaultValue;
}

function readStringField(field: BoardFieldSchema): string {
  const raw = readFieldRawValue(field);
  return typeof raw === "string" ? raw : raw === undefined || raw === null ? "" : String(raw);
}

function readNumberField(field: BoardFieldSchema): number | null {
  const raw = readFieldRawValue(field);
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return null;
  }
  return value;
}

function readBooleanField(field: BoardFieldSchema): boolean {
  const raw = readFieldRawValue(field);
  if (typeof raw === "boolean") {
    return raw;
  }
  return Boolean(raw);
}

function readSelectField(field: BoardFieldSchema): string {
  const raw = readFieldRawValue(field);
  if (typeof raw === "string") {
    return raw;
  }
  return typeof field.defaultValue === "string" ? field.defaultValue : "";
}

function emitUpdate(key: string, value: unknown): void {
  emit("update-field", {
    nodeId: props.card.nodeId,
    key,
    value,
  });
}

function writeStringField(field: BoardFieldSchema, value: string | number | null): void {
  emitUpdate(field.key, typeof value === "string" ? value : value == null ? "" : String(value));
}

function writeNumberField(field: BoardFieldSchema, value: string | number | null): void {
  if (value === null || value === "") {
    emitUpdate(field.key, undefined);
    return;
  }

  const number = Number(value);
  emitUpdate(field.key, Number.isFinite(number) ? number : undefined);
}

function writeBooleanField(field: BoardFieldSchema, value: boolean): void {
  emitUpdate(field.key, Boolean(value));
}

function writeSelectField(field: BoardFieldSchema, value: string | null): void {
  emitUpdate(field.key, value ?? "");
}

function emitPickPath(key: string, directory: boolean): void {
  emit("pick-path", {
    nodeId: props.card.nodeId,
    key,
    directory,
  });
}
</script>

<style scoped>
.board-node-card {
  background: rgba(240, 255, 252, 0.86);
  border-color: rgba(9, 91, 85, 0.15);
  color: #15423f;
}
</style>
