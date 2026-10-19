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
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

import { REFRESH_INTERRUPTED_KEY } from "@/constants/Constants";
import {
  clearInterruptedRefresh,
  markRefreshInterrupted,
  readInterruptedRefresh,
} from "@/utils/rotationGuard";
import AsyncStorage from "@react-native-async-storage/async-storage";

describe("rotationGuard", () => {
  beforeEach(async () => {
    jest.restoreAllMocks();
    await AsyncStorage.clear();
  });

  it("reads null when no refresh has ever been interrupted", async () => {
    expect(await readInterruptedRefresh()).toBeNull();
  });

  it("round-trips the timestamp of an interrupted refresh", async () => {
    await markRefreshInterrupted(1_700_000_000_000);

    expect(await readInterruptedRefresh()).toEqual({
      interruptedAt: 1_700_000_000_000,
    });
  });

  it("keeps the oldest marker: a second interruption doesn't overwrite the first", async () => {
    await markRefreshInterrupted(1);
    await markRefreshInterrupted(2);

    expect(await readInterruptedRefresh()).toEqual({ interruptedAt: 1 });
  });

  it("clears the marker once a response finally arrives", async () => {
    await markRefreshInterrupted(1);

    await clearInterruptedRefresh();

    expect(await readInterruptedRefresh()).toBeNull();
  });

  it("treats a corrupt stored value as no marker and clears it", async () => {
    await AsyncStorage.setItem(REFRESH_INTERRUPTED_KEY, "not-json");

    expect(await readInterruptedRefresh()).toBeNull();
    expect(await AsyncStorage.getItem(REFRESH_INTERRUPTED_KEY)).toBeNull();
  });

  it("returns null instead of throwing when storage can't be read", async () => {
    jest
      .spyOn(AsyncStorage, "getItem")
      .mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(readInterruptedRefresh()).resolves.toBeNull();
  });

  it("never lets a failed write break the refresh it was guarding", async () => {
    jest
      .spyOn(AsyncStorage, "setItem")
      .mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(markRefreshInterrupted(1)).resolves.toBeUndefined();
  });
});
