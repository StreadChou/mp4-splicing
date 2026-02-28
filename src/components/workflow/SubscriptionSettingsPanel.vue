<template>
  <q-card flat bordered class="settings-card">
    <q-card-section class="row items-center q-gutter-sm">
      <div class="text-h6 text-weight-medium">订阅设置</div>
      <q-space />
      <q-btn flat dense round icon="refresh" :disable="loading || saving" @click="loadKeys">
        <q-tooltip>刷新订阅信息</q-tooltip>
      </q-btn>
    </q-card-section>

    <q-separator />

    <q-card-section class="q-gutter-md">
      <q-banner rounded dense class="bg-teal-1 text-teal-10">
        可保存多个激活码，并在已保存激活码之间切换当前生效 key。
      </q-banner>

      <div class="add-key-row">
        <div class="add-key-input-wrap">
          <q-input
            v-model="newCode"
            outlined
            label="新增激活码"
            placeholder="输入激活码后点添加"
            :disable="loading || saving"
            @keyup.enter="handleAddKey"
          />
        </div>
        <q-btn
          class="add-key-btn"
          color="primary"
          icon="add"
          label="添加"
          :loading="saving"
          :disable="loading || saving"
          @click="handleAddKey"
        />
      </div>

      <q-list bordered separator class="rounded-borders">
        <q-item
          v-for="item in keys"
          :key="item.activationCode"
          :class="[
            'license-key-item',
            item.status === 'invalid'
              ? 'license-key-item-invalid'
              : (item.activationCode === activeCode ? 'license-key-item-active' : 'license-key-item-inactive'),
          ]"
        >
          <q-item-section>
            <q-item-label class="text-weight-medium">{{ item.activationCode }}</q-item-label>
            <q-item-label caption>
              权限：{{ unlockLabel(item.unlockPayload) }}
            </q-item-label>
            <q-item-label caption>
              最近验证：{{ formatDate(item.lastVerifiedAt) || '未验证' }} · 状态：
              <span :class="item.status === 'valid' ? 'text-positive' : 'text-negative'">
                {{ item.status === "valid" ? "有效" : "失效" }}
              </span>
            </q-item-label>
          </q-item-section>

          <q-item-section side>
            <div class="row items-center q-gutter-xs no-wrap">
              <q-btn
                flat
                dense
                icon="swap_horiz"
                color="teal-8"
                :disable="loading || saving || item.activationCode === activeCode || item.status !== 'valid'"
                @click="handleSwitchKey(item.activationCode)"
              >
                <q-tooltip>切换为当前 key</q-tooltip>
              </q-btn>
              <q-btn
                flat
                dense
                icon="delete"
                color="negative"
                :disable="loading || saving"
                @click="handleRemoveKey(item.activationCode)"
              >
                <q-tooltip>删除该 key</q-tooltip>
              </q-btn>
            </div>
          </q-item-section>
        </q-item>

        <q-item v-if="keys.length === 0">
          <q-item-section>
            <q-item-label class="text-grey-6">尚未保存激活码</q-item-label>
          </q-item-section>
        </q-item>
      </q-list>

      <q-banner v-if="errorMsg" rounded class="bg-negative text-white">
        {{ errorMsg }}
      </q-banner>
      <q-banner v-else-if="successMsg" rounded class="bg-positive text-white">
        {{ successMsg }}
      </q-banner>
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import type { LicenseKeyProfile, LicenseUnlockPayload } from "src/components/workflow/types";
import { addLicenseKey, listLicenseKeys, removeLicenseKey, switchLicenseKey } from "src/api/license-api";

const emit = defineEmits<{
  "license-switched": [];
}>();
const router = useRouter();

const loading = ref(false);
const saving = ref(false);
const newCode = ref("");
const keys = ref<LicenseKeyProfile[]>([]);
const activeCode = ref("");
const errorMsg = ref("");
const successMsg = ref("");

function formatDate(value: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString();
}

function unlockLabel(unlock: LicenseUnlockPayload | null): string {
  if (!unlock) {
    return "未知";
  }
  if (unlock.unlock === "all") {
    return "全功能";
  }
  return `工作流授权（${unlock.workflows.length}个流程 + ${unlock.nodes.length}个节点）`;
}

async function loadKeys() {
  loading.value = true;
  errorMsg.value = "";
  successMsg.value = "";
  try {
    const result = await listLicenseKeys();
    keys.value = result.keys;
    activeCode.value = result.activeCode;
  } catch (error) {
    errorMsg.value = String(error);
  } finally {
    loading.value = false;
  }
}

async function handleAddKey() {
  const code = newCode.value.trim();
  if (!code) {
    errorMsg.value = "请输入激活码";
    return;
  }

  saving.value = true;
  errorMsg.value = "";
  successMsg.value = "";
  try {
    const result = await addLicenseKey(code);
    keys.value = result.keys;
    activeCode.value = result.activeCode;
    newCode.value = "";
    successMsg.value = "激活码已添加";
  } catch (error) {
    errorMsg.value = String(error);
  } finally {
    saving.value = false;
  }
}

async function handleSwitchKey(code: string) {
  saving.value = true;
  errorMsg.value = "";
  successMsg.value = "";
  try {
    const result = await switchLicenseKey(code);
    keys.value = result.keys;
    activeCode.value = result.activeCode;
    successMsg.value = "已切换生效激活码";
    emit("license-switched");
  } catch (error) {
    errorMsg.value = String(error);
  } finally {
    saving.value = false;
  }
}

async function handleRemoveKey(code: string) {
  const confirmed = window.confirm("确认删除该激活码？");
  if (!confirmed) {
    return;
  }

  const previousActiveCode = activeCode.value;
  saving.value = true;
  errorMsg.value = "";
  successMsg.value = "";
  try {
    const result = await removeLicenseKey(code);
    keys.value = result.keys;
    activeCode.value = result.activeCode;
    if (!result.state.activated || !result.activeCode) {
      successMsg.value = "最后一个激活码已删除，正在返回激活页面";
      await router.replace("/activate");
      return;
    }

    if (previousActiveCode === code && result.activeCode !== previousActiveCode) {
      successMsg.value = "已删除当前激活码，已自动切换到下一个激活码";
      emit("license-switched");
      return;
    }

    successMsg.value = "激活码已删除";
  } catch (error) {
    errorMsg.value = String(error);
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void loadKeys();
});
</script>

<style scoped>
.settings-card {
  min-height: calc(100vh - 120px);
  background: rgba(255, 255, 255, 0.84);
  border-color: rgba(9, 91, 85, 0.15);
  color: #15423f;
}

.add-key-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}

.add-key-input-wrap {
  flex: 1 1 auto;
}

.add-key-btn {
  min-height: 56px;
  align-self: stretch;
}

.license-key-item {
  transition: background-color 0.18s ease;
}

.license-key-item-active {
  background: rgba(34, 197, 94, 0.12);
}

.license-key-item-inactive {
  background: rgba(148, 163, 184, 0.08);
}

.license-key-item-invalid {
  background: rgba(239, 68, 68, 0.1);
}

@media (max-width: 640px) {
  .add-key-row {
    flex-direction: column;
  }

  .add-key-btn {
    width: 100%;
  }
}
</style>
