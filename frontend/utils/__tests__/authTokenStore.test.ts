// Copyright (c) 2026 WSO2 LLC. (https://www.wso2.com).
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
// jest-expo's expo-secure-store mock doesn't keep values, and these tests are
// about what ends up on disk, so the keychain is stood in for by a plain map.
const mockStore = new Map<string, string>();
const mockSetItemAsync = jest.fn();
const mockGetItemAsync = jest.fn();
const mockDeleteItemAsync = jest.fn();
jest.mock("expo-secure-store", () => ({
  setItemAsync: (key: string, value: string) => mockSetItemAsync(key, value),
  getItemAsync: (key: string) => mockGetItemAsync(key),
  deleteItemAsync: (key: string) => mockDeleteItemAsync(key),
}));

import {
  ACCESS_TOKEN,
  AUTH_BUNDLE_KEY,
  AUTH_EMAIL_KEY,
  EXPIRES_AT_KEY,
  ID_TOKEN,
  REFRESH_TOKEN,
  USER_ID_KEY,
} from "@/constants/Constants";
import {
  clearAuthDataFromSecureStore,
  loadAuthDataFromSecureStore,
  saveAuthDataToSecureStore,
  SecureAuthData,
} from "@/utils/authTokenStore";

const LEGACY_KEYS = [
  ACCESS_TOKEN,
  REFRESH_TOKEN,
  ID_TOKEN,
  EXPIRES_AT_KEY,
  AUTH_EMAIL_KEY,
  USER_ID_KEY,
];

const authData: SecureAuthData = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  idToken: "id-1",
  email: "someone@example.com",
  userId: "user-1",
  expiresAt: 1750000000000,
};

function seedLegacyKeys() {
  mockStore.set(ACCESS_TOKEN, authData.accessToken);
  mockStore.set(REFRESH_TOKEN, authData.refreshToken);
  mockStore.set(ID_TOKEN, authData.idToken);
  mockStore.set(EXPIRES_AT_KEY, String(authData.expiresAt));
  mockStore.set(AUTH_EMAIL_KEY, authData.email!);
  mockStore.set(USER_ID_KEY, authData.userId!);
}

beforeEach(() => {
  mockStore.clear();
  mockSetItemAsync.mockReset().mockImplementation(async (key, value) => {
    mockStore.set(key, value);
  });
  mockGetItemAsync.mockReset().mockImplementation(async (key) => {
    return mockStore.has(key) ? mockStore.get(key) : null;
  });
  mockDeleteItemAsync.mockReset().mockImplementation(async (key) => {
    mockStore.delete(key);
  });
  // The fallback path warns on purpose; the assertions decide whether it behaved.
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("saveAuthDataToSecureStore", () => {
  it("writes the whole token set as a single key, so a kill mid-save can't split it", async () => {
    await saveAuthDataToSecureStore(authData);

    expect(mockSetItemAsync).toHaveBeenCalledTimes(1);
    expect(mockSetItemAsync).toHaveBeenCalledWith(
      AUTH_BUNDLE_KEY,
      expect.any(String)
    );
    expect([...mockStore.keys()]).toEqual([AUTH_BUNDLE_KEY]);
    expect(JSON.parse(mockStore.get(AUTH_BUNDLE_KEY)!)).toEqual(authData);
  });

  it("removes the legacy keys once the bundle is written", async () => {
    seedLegacyKeys();

    await saveAuthDataToSecureStore(authData);

    for (const key of LEGACY_KEYS) {
      expect(mockStore.has(key)).toBe(false);
    }
    expect(mockStore.has(AUTH_BUNDLE_KEY)).toBe(true);
  });

  it("still saves when the legacy cleanup fails", async () => {
    seedLegacyKeys();
    mockDeleteItemAsync.mockRejectedValueOnce(new Error("keychain unavailable"));

    await expect(saveAuthDataToSecureStore(authData)).resolves.toBeUndefined();

    expect(JSON.parse(mockStore.get(AUTH_BUNDLE_KEY)!)).toEqual(authData);
  });
});

describe("loadAuthDataFromSecureStore", () => {
  it("round-trips what save wrote", async () => {
    await saveAuthDataToSecureStore(authData);

    expect(await loadAuthDataFromSecureStore()).toEqual(authData);
  });

  it("round-trips a token set with no email or userId", async () => {
    const minimal: SecureAuthData = {
      accessToken: "access-2",
      refreshToken: "refresh-2",
      idToken: "id-2",
      expiresAt: 1750000000001,
    };

    await saveAuthDataToSecureStore(minimal);
    const loaded = await loadAuthDataFromSecureStore();

    expect(loaded).toEqual(minimal);
    expect(loaded?.email).toBeUndefined();
    expect(loaded?.userId).toBeUndefined();
  });

  it("migrates a store that still holds only the legacy keys", async () => {
    seedLegacyKeys();

    expect(await loadAuthDataFromSecureStore()).toEqual(authData);

    expect(JSON.parse(mockStore.get(AUTH_BUNDLE_KEY)!)).toEqual(authData);
    for (const key of LEGACY_KEYS) {
      expect(mockStore.has(key)).toBe(false);
    }
  });

  it("falls back to the legacy keys when the bundle is corrupt", async () => {
    mockStore.set(AUTH_BUNDLE_KEY, "{not json");
    seedLegacyKeys();

    expect(await loadAuthDataFromSecureStore()).toEqual(authData);

    expect(JSON.parse(mockStore.get(AUTH_BUNDLE_KEY)!)).toEqual(authData);
  });

  it("returns null without throwing when the bundle is corrupt and there are no legacy keys", async () => {
    mockStore.set(AUTH_BUNDLE_KEY, "{not json");

    await expect(loadAuthDataFromSecureStore()).resolves.toBeNull();
  });

  it("returns null when the legacy set is incomplete", async () => {
    seedLegacyKeys();
    mockStore.delete(REFRESH_TOKEN);

    expect(await loadAuthDataFromSecureStore()).toBeNull();
  });
});

describe("clearAuthDataFromSecureStore", () => {
  it("removes the bundle and every legacy key", async () => {
    await saveAuthDataToSecureStore(authData);
    seedLegacyKeys();

    await clearAuthDataFromSecureStore();

    expect(mockStore.size).toBe(0);
  });
});

describe("when the bundle will not persist", () => {
  // expo-secure-store only warns past its 2048-byte limit, and three JWTs in one blob
  // can pass it. The write still resolves, having stored nothing.
  const dropBundleWrites = () => {
    mockSetItemAsync.mockImplementation(async (key: string, value: string) => {
      if (key === AUTH_BUNDLE_KEY) return;
      mockStore.set(key, value);
    });
  };

  it("falls back to the per-field keys rather than losing the session", async () => {
    dropBundleWrites();

    await saveAuthDataToSecureStore(authData);

    expect(mockStore.has(AUTH_BUNDLE_KEY)).toBe(false);
    expect(mockStore.get(ACCESS_TOKEN)).toBe(authData.accessToken);
    expect(mockStore.get(REFRESH_TOKEN)).toBe(authData.refreshToken);
    expect(mockStore.get(ID_TOKEN)).toBe(authData.idToken);
    expect(mockStore.get(EXPIRES_AT_KEY)).toBe(String(authData.expiresAt));
    expect(await loadAuthDataFromSecureStore()).toEqual(authData);
  });

  it("does the same when the write throws instead of warning", async () => {
    mockSetItemAsync.mockImplementation(async (key: string, value: string) => {
      if (key === AUTH_BUNDLE_KEY) throw new Error("value too large");
      mockStore.set(key, value);
    });

    await saveAuthDataToSecureStore(authData);

    expect(mockStore.has(AUTH_BUNDLE_KEY)).toBe(false);
    expect(await loadAuthDataFromSecureStore()).toEqual(authData);
  });

  it("leaves an existing install's keys in place instead of deleting them", async () => {
    seedLegacyKeys();
    dropBundleWrites();

    await saveAuthDataToSecureStore(authData);

    for (const key of LEGACY_KEYS) {
      expect(mockStore.has(key)).toBe(true);
    }
  });
});
