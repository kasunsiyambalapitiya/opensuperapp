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
import { AppDispatch } from "@/context/store";
import { runMigrations } from "@/migrations/migrator";
import { handleFreshInstall } from "@/utils/freshInstall";
import { initializeApp } from "@/utils/initializeApp";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getItemAsync } from "expo-secure-store";

jest.mock("@react-native-async-storage/async-storage", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn() }));
jest.mock("@/constants/Constants", () => ({
  APPS: "apps",
  USER_INFO: "user-info",
}));
jest.mock("@/context/store", () => ({}));
jest.mock("@/utils/freshInstall", () => ({ handleFreshInstall: jest.fn() }));
jest.mock("@/migrations/migrator", () => ({ runMigrations: jest.fn() }));
jest.mock("@/utils/exchangedTokenRehydrator", () => ({
  buildAppsWithTokens: async (apps: unknown) => apps,
}));
jest.mock("@/context/slices/appSlice", () => ({
  setApps: (payload: unknown) => ({ type: "apps/setApps", payload }),
}));
jest.mock("@/context/slices/userInfoSlice", () => ({
  setUserInfo: (payload: unknown) => ({ type: "userInfo/set", payload }),
}));
jest.mock("@/context/slices/versionSlice", () => ({
  getVersions: () => ({ type: "version/get" }),
}));
jest.mock("@/context/slices/userConfigSlice", () => ({
  getUserConfigurations: () => ({ type: "userConfig/get" }),
}));
jest.mock("@/context/slices/authSlice", () => ({
  restoreAuth: () => ({ type: "auth/restoreAuth" }),
  setSessionEnd: (payload: unknown) => ({ type: "auth/setSessionEnd", payload }),
}));

const dispatched = (dispatch: jest.Mock) =>
  dispatch.mock.calls.map(([action]) => action.type);

const buildDispatch = () =>
  jest.fn((action: { type: string }) =>
    action.type === "auth/restoreAuth"
      ? { unwrap: () => Promise.resolve() }
      : action
  );

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Until restoreAuth runs the session stays "restoring", which is neither signed in nor
// signed out, so a failure in any earlier step left the app stuck behind it.
describe("initializeApp", () => {
  it("restores the session after the steps that prepare the store for it", async () => {
    const dispatch = buildDispatch();

    await initializeApp(dispatch as unknown as AppDispatch);

    expect(handleFreshInstall).toHaveBeenCalled();
    expect(runMigrations).toHaveBeenCalled();
    expect(dispatched(dispatch)).toContain("auth/restoreAuth");
  });

  it("restores the session even when a migration fails", async () => {
    (runMigrations as jest.Mock).mockRejectedValueOnce(new Error("migration"));
    const dispatch = buildDispatch();

    await initializeApp(dispatch as unknown as AppDispatch);

    expect(dispatched(dispatch)).toContain("auth/restoreAuth");
  });

  it("restores the session even when the cached apps cannot be read", async () => {
    await AsyncStorage.setItem("apps", "not json");
    const dispatch = buildDispatch();

    await initializeApp(dispatch as unknown as AppDispatch);

    expect(dispatched(dispatch)).toContain("auth/restoreAuth");
  });

  // A failed marker read leaves whatever survived an uninstall in SecureStore, which may
  // be the previous user's session.
  it("settles signed out, restoring nothing, when the fresh-install check fails", async () => {
    (handleFreshInstall as jest.Mock).mockRejectedValueOnce(
      new Error("marker read")
    );
    (getItemAsync as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({ name: "previous user" })
    );
    const dispatch = buildDispatch();

    await initializeApp(dispatch as unknown as AppDispatch);

    expect(dispatched(dispatch)).not.toContain("auth/restoreAuth");
    expect(dispatched(dispatch)).not.toContain("userInfo/set");
    expect(dispatch).toHaveBeenCalledWith({
      type: "auth/setSessionEnd",
      payload: { status: "signedOut" },
    });
    expect(runMigrations).toHaveBeenCalled();
  });

  it("settles when the restore itself fails", async () => {
    const dispatch = jest.fn(() => ({
      unwrap: () => Promise.reject(new Error("keychain")),
    }));

    await expect(
      initializeApp(dispatch as unknown as AppDispatch)
    ).resolves.toBeUndefined();
  });
});
