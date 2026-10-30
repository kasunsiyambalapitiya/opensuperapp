// Copyright (c) 2025 WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.
import {
  ACCESS_TOKEN,
  AUTH_BUNDLE_KEY,
  AUTH_EMAIL_KEY,
  EXPIRES_AT_KEY,
  ID_TOKEN,
  REFRESH_TOKEN,
  USER_ID_KEY,
} from "@/constants/Constants";
import { deleteItemAsync, getItemAsync, setItemAsync } from "expo-secure-store";

export type SecureAuthData = {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  email?: string;
  userId?: string;
  expiresAt: number;
};

const LEGACY_KEYS = [
  ACCESS_TOKEN,
  REFRESH_TOKEN,
  ID_TOKEN,
  EXPIRES_AT_KEY,
  AUTH_EMAIL_KEY,
  USER_ID_KEY,
];

/**
 * Best-effort: the bundle is already the source of truth by this point, so a
 * failed delete only leaves dead keys behind, never a reason to fail the caller.
 */
async function deleteLegacyKeys() {
  await Promise.allSettled(LEGACY_KEYS.map((key) => deleteItemAsync(key)));
}

function parseBundle(raw: string): SecureAuthData | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const bundle = parsed as Partial<SecureAuthData>;
  if (!bundle.accessToken || !bundle.refreshToken || !bundle.idToken) {
    return null;
  }
  const expiresAt = bundle.expiresAt;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;

  return {
    accessToken: bundle.accessToken,
    refreshToken: bundle.refreshToken,
    idToken: bundle.idToken,
    email: bundle.email || undefined,
    userId: bundle.userId || undefined,
    expiresAt,
  };
}

async function loadLegacyAuthData(): Promise<SecureAuthData | null> {
  const [accessToken, refreshToken, idToken, expiresAtStr, email, userId] =
    await Promise.all([
      getItemAsync(ACCESS_TOKEN),
      getItemAsync(REFRESH_TOKEN),
      getItemAsync(ID_TOKEN),
      getItemAsync(EXPIRES_AT_KEY),
      getItemAsync(AUTH_EMAIL_KEY),
      getItemAsync(USER_ID_KEY),
    ]);

  if (!accessToken || !refreshToken || !idToken || !expiresAtStr) return null;

  return {
    accessToken,
    refreshToken,
    idToken,
    email: email || undefined,
    userId: userId || undefined,
    expiresAt: Number(expiresAtStr),
  };
}

async function saveLegacyAuthData(authData: SecureAuthData) {
  await Promise.all([
    setItemAsync(ACCESS_TOKEN, authData.accessToken),
    setItemAsync(REFRESH_TOKEN, authData.refreshToken),
    setItemAsync(ID_TOKEN, authData.idToken),
    setItemAsync(EXPIRES_AT_KEY, String(authData.expiresAt)),
    authData.email
      ? setItemAsync(AUTH_EMAIL_KEY, authData.email)
      : deleteItemAsync(AUTH_EMAIL_KEY),
    authData.userId
      ? setItemAsync(USER_ID_KEY, authData.userId)
      : deleteItemAsync(USER_ID_KEY),
  ]);
}

// One key, one write: over six keys, a kill mid-save could leave a new access
// token paired with the previous refresh token.
//
// expo-secure-store only warns when a value passes its 2048-byte limit, and three JWTs
// in one blob can pass it. Such a write still resolves, so reading it back is the only
// proof it landed - and the per-field keys are the one fallback left once they are gone.
export async function saveAuthDataToSecureStore(authData: SecureAuthData) {
  const bundle = JSON.stringify(authData);

  let stored: string | null = null;
  try {
    await setItemAsync(AUTH_BUNDLE_KEY, bundle);
    stored = await getItemAsync(AUTH_BUNDLE_KEY);
  } catch (error) {
    console.warn("Could not write the auth bundle", error);
  }

  if (stored === bundle) {
    await deleteLegacyKeys();
    return;
  }

  // Too large for one value on this platform. An atomic write is worth less than a
  // session, so keep the per-field keys and drop the bundle a later read would prefer.
  console.warn("Auth bundle did not persist; storing per-field keys instead.");
  await saveLegacyAuthData(authData);
  await deleteItemAsync(AUTH_BUNDLE_KEY);
}

export async function loadAuthDataFromSecureStore(): Promise<SecureAuthData | null> {
  const raw = await getItemAsync(AUTH_BUNDLE_KEY);
  if (raw) {
    const bundle = parseBundle(raw);
    if (bundle) return bundle;
    // Corrupt or half-written: an older install may still hold the legacy keys.
  }

  const legacy = await loadLegacyAuthData();
  if (!legacy) return null;

  await saveAuthDataToSecureStore(legacy);
  return legacy;
}

export async function clearAuthDataFromSecureStore() {
  await Promise.all([
    deleteItemAsync(AUTH_BUNDLE_KEY),
    ...LEGACY_KEYS.map((key) => deleteItemAsync(key)),
  ]);
}
