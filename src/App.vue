<template>
  <router-view />
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { useRoute } from "vue-router";
import { backgroundValidateLicense, getLicenseState } from "src/api/license-api";
import { licenseKickToActivate } from "src/tauri-compat/core";

const route = useRoute();

async function runBackgroundLicenseValidation() {
  if (route.path === "/activate") {
    return;
  }

  const state = await getLicenseState();
  if (!state.activated || !state.needsValidation) {
    return;
  }

  const result = await backgroundValidateLicense();
  if (!result.valid) {
    await licenseKickToActivate(result.message);
  }
}

onMounted(() => {
  void runBackgroundLicenseValidation().catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    await licenseKickToActivate(message || "授权复验失败，请重新激活");
  });
});
</script>
