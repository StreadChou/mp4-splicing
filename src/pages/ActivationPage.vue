<template>
  <div class="activation-page row items-center justify-center">
    <q-card flat bordered class="activation-card">
      <q-card-section>
        <div class="text-h6 text-weight-bold">软件激活</div>
        <div class="text-caption text-grey-7 q-mt-xs">请输入激活码后继续使用 MP4 工作流平台。</div>
      </q-card-section>

      <q-separator />

      <q-card-section class="q-gutter-md">
        <q-input
          v-model="activationCode"
          outlined
          label="激活码"
          placeholder="例如: MP4H-ALL-..."
          :disable="loading"
          @keyup.enter="submitActivation"
        />

        <q-banner v-if="errorMsg" rounded class="bg-negative text-white">
          {{ errorMsg }}
        </q-banner>
        <q-banner v-else-if="successMsg" rounded class="bg-positive text-white">
          {{ successMsg }}
        </q-banner>

        <q-banner v-if="licenseState.activated" rounded class="bg-teal-1 text-teal-10">
          当前状态：已激活
        </q-banner>

        <q-list bordered separator class="rounded-borders">
          <q-item-label header>已保存激活码</q-item-label>
          <q-item v-for="item in keyProfiles" :key="item.activationCode">
            <q-item-section>
              <q-item-label class="text-weight-medium">{{ item.activationCode }}</q-item-label>
              <q-item-label caption>
                状态：
                <span :class="item.status === 'valid' ? 'text-positive' : 'text-negative'">
                  {{ item.status === "valid" ? "有效" : "失效" }}
                </span>
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <div class="row items-center q-gutter-xs">
                <q-chip
                  dense
                  :color="item.activationCode === activeCode ? 'positive' : 'grey-4'"
                  :text-color="item.activationCode === activeCode ? 'white' : 'grey-9'"
                >
                  {{ item.activationCode === activeCode ? "当前生效" : "未生效" }}
                </q-chip>
                <q-btn
                  flat
                  dense
                  icon="login"
                  color="primary"
                  :disable="loading || item.status !== 'valid'"
                  @click="switchFromList(item.activationCode)"
                >
                  <q-tooltip>切换并进入</q-tooltip>
                </q-btn>
              </div>
            </q-item-section>
          </q-item>
          <q-item v-if="keyProfiles.length === 0">
            <q-item-section>
              <q-item-label class="text-grey-6">暂无已保存激活码</q-item-label>
            </q-item-section>
          </q-item>
        </q-list>

        <div class="row q-gutter-sm">
          <q-btn
            color="primary"
            icon="vpn_key"
            label="激活并进入"
            :loading="loading"
            :disable="loading"
            @click="submitActivation"
          />
          <q-btn
            flat
            icon="refresh"
            label="刷新状态"
            :disable="loading"
            @click="loadLicenseState"
          />
          <q-btn
            v-if="licenseState.activated"
            flat
            icon="arrow_forward"
            label="直接进入"
            :disable="loading"
            @click="enterApp"
          />
        </div>
      </q-card-section>
    </q-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { activateLicense, getLicenseState, listLicenseKeys, switchLicenseKey } from "src/api/license-api";
import type { LicenseKeyProfile, LicenseState } from "src/components/workflow/types";

const router = useRouter();

const loading = ref(false);
const activationCode = ref("");
const errorMsg = ref("");
const successMsg = ref("");
const keyProfiles = ref<LicenseKeyProfile[]>([]);
const activeCode = ref("");
const licenseState = ref<LicenseState>({
  activated: false,
  cacheValid: false,
  needsValidation: false,
  lastVerifiedAt: "",
  cachedUntil: "",
  unlockPayload: null,
  effectiveAllowedNodeTypes: [],
});

async function loadLicenseState() {
  errorMsg.value = "";
  try {
    licenseState.value = await getLicenseState();
  } catch (error) {
    errorMsg.value = String(error);
  }
}

async function loadLicenseKeys() {
  try {
    const result = await listLicenseKeys();
    keyProfiles.value = result.keys;
    activeCode.value = result.activeCode;
  } catch (error) {
    errorMsg.value = String(error);
  }
}

async function submitActivation() {
  const code = activationCode.value.trim();
  if (!code) {
    errorMsg.value = "请输入激活码";
    return;
  }

  loading.value = true;
  errorMsg.value = "";
  successMsg.value = "";

  try {
    const result = await activateLicense(code);
    licenseState.value = result.state;
    successMsg.value = result.message || "激活成功";
    await loadLicenseKeys();
    await router.replace("/");
  } catch (error) {
    errorMsg.value = String(error);
  } finally {
    loading.value = false;
  }
}

async function switchFromList(code: string) {
  loading.value = true;
  errorMsg.value = "";
  successMsg.value = "";
  try {
    const result = await switchLicenseKey(code);
    keyProfiles.value = result.keys;
    activeCode.value = result.activeCode;
    licenseState.value = result.state;
    successMsg.value = "已切换激活码";
    await router.replace("/");
  } catch (error) {
    errorMsg.value = String(error);
  } finally {
    loading.value = false;
  }
}

async function enterApp() {
  await router.replace("/");
}

onMounted(() => {
  void loadLicenseState();
  void loadLicenseKeys();
});
</script>

<style scoped>
.activation-page {
  min-height: 100vh;
  padding: 24px;
  background:
    radial-gradient(circle at 0% 0%, rgba(34, 197, 94, 0.12), transparent 42%),
    radial-gradient(circle at 100% 100%, rgba(14, 165, 233, 0.14), transparent 48%),
    linear-gradient(140deg, #f7faf9 0%, #eef6f4 100%);
}

.activation-card {
  width: min(600px, 100%);
  border-radius: 16px;
  border-color: rgba(14, 116, 144, 0.2);
  background: rgba(255, 255, 255, 0.92);
}
</style>
