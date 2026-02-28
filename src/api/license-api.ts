import { invoke } from "src/tauri-compat/core";
import type {
  LicenseActivationResult,
  LicenseBackgroundValidateResult,
  LicenseKeysResult,
  LicenseState,
} from "src/components/workflow/types";

export async function getLicenseState(): Promise<LicenseState> {
  return invoke<LicenseState>("license:get-state");
}

export async function activateLicense(code: string): Promise<LicenseActivationResult> {
  return invoke<LicenseActivationResult>("license:activate", { code });
}

export async function backgroundValidateLicense(): Promise<LicenseBackgroundValidateResult> {
  return invoke<LicenseBackgroundValidateResult>("license:background-validate");
}

export async function listLicenseKeys(): Promise<LicenseKeysResult> {
  return invoke<LicenseKeysResult>("license:list-keys");
}

export async function addLicenseKey(code: string): Promise<LicenseKeysResult> {
  return invoke<LicenseKeysResult>("license:add-key", { code });
}

export async function switchLicenseKey(code: string): Promise<LicenseKeysResult> {
  return invoke<LicenseKeysResult>("license:switch-key", { code });
}

export async function removeLicenseKey(code: string): Promise<LicenseKeysResult> {
  return invoke<LicenseKeysResult>("license:remove-key", { code });
}
