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

// A failed fetch is not a reason to empty the grid: the list on disk is still
// the user's. Only the end of a session clears it, and that is endSession's job.
import { loadMicroAppDetails } from "@/services/appStoreService";
import { apiRequest } from "@/utils/requestHandler";
import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("@react-native-async-storage/async-storage", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);
jest.mock("@/constants/Constants", () => ({
  APPS: "apps",
  BASE_URL: "https://api.example.com",
  DEFAULT_VIEWING_MODE: "fullscreen",
  DOWNLOADED: "downloaded",
  MICRO_APP_STORAGE_DIR: "micro-apps",
  NOT_DOWNLOADED: "not-downloaded",
}));
jest.mock("@/utils/requestHandler", () => ({ apiRequest: jest.fn() }));
jest.mock("@/context/store", () => ({
  store: { getState: () => ({ auth: { userId: "user-1" } }) },
}));
jest.mock("@/context/slices/appSlice", () => ({
  setApps: (payload: unknown) => ({ type: "apps/setApps", payload }),
}));
jest.mock("@/utils/exchangedTokenRehydrator", () => ({
  buildAppsWithTokens: async (apps: unknown) => apps,
}));
jest.mock("@/utils/exchangedTokenStore", () => ({
  persistAppsWithoutTokens: jest.fn(),
}));
jest.mock("@/services/userConfigService", () => ({
  UpdateUserConfiguration: jest.fn(),
}));
jest.mock("expo-file-system", () => ({
  Directory: jest.fn(),
  File: jest.fn(),
  Paths: { document: "file:///doc/" },
}));
jest.mock("jszip", () => ({}));

const STORED_APPS = [
  { appId: "app-a", name: "A", status: "downloaded", versions: [] },
];

const setAppsPayloads = (dispatch: jest.Mock) =>
  dispatch.mock.calls
    .map(([action]) => action)
    .filter((action) => action.type === "apps/setApps")
    .map((action) => action.payload);

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await AsyncStorage.setItem("apps", JSON.stringify(STORED_APPS));
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("loadMicroAppDetails", () => {
  it("keeps the stored list when the network request fails", async () => {
    (apiRequest as jest.Mock).mockRejectedValue(new Error("Network Error"));
    const dispatch = jest.fn();

    await loadMicroAppDetails(dispatch);

    expect(setAppsPayloads(dispatch)).toEqual([STORED_APPS]);
  });

  it("keeps the stored list when the refresh failed and nothing came back", async () => {
    (apiRequest as jest.Mock).mockResolvedValue(undefined);
    const dispatch = jest.fn();

    await loadMicroAppDetails(dispatch);

    expect(setAppsPayloads(dispatch)).toEqual([STORED_APPS]);
  });
});
