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
import {
  enqueueForReconnect,
  setupOfflineQueueReplay,
} from "@/utils/offlineQueue";

const mockUnsubscribe = jest.fn();
let mockListener: ((online: boolean) => void) | undefined;
jest.mock("@/utils/connectivity", () => ({
  subscribeToConnectivity: (listener: (online: boolean) => void) => {
    mockListener = listener;
    return mockUnsubscribe;
  },
}));

const setOnline = (online: boolean) => mockListener?.(online);

let teardown: () => void = () => {};

beforeEach(() => {
  mockListener = undefined;
  mockUnsubscribe.mockClear();
  teardown = setupOfflineQueueReplay();
  // Whatever an earlier test left queued runs here and is gone.
  setOnline(false);
  setOnline(true);
});

afterEach(() => {
  teardown();
});

describe("offline queue", () => {
  it("runs nothing while the device stays offline", () => {
    const task = jest.fn();
    setOnline(false);

    enqueueForReconnect("push", task);

    expect(task).not.toHaveBeenCalled();
  });

  it("runs a queued task on reconnect, exactly once", () => {
    const task = jest.fn();
    setOnline(false);
    enqueueForReconnect("push", task);

    setOnline(true);
    setOnline(false);
    setOnline(true);

    expect(task).toHaveBeenCalledTimes(1);
  });

  it("keeps only the newest task for a key", () => {
    const stale = jest.fn();
    const fresh = jest.fn();
    setOnline(false);
    enqueueForReconnect("push", stale);
    enqueueForReconnect("push", fresh);

    setOnline(true);

    expect(stale).not.toHaveBeenCalled();
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it("runs every key's task, even when one of them throws", () => {
    const broken = jest.fn(() => {
      throw new Error("boom");
    });
    const other = jest.fn();
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    setOnline(false);
    enqueueForReconnect("broken", broken);
    enqueueForReconnect("other", other);

    setOnline(true);

    expect(broken).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("lets a task that fails again queue itself for the next reconnect", () => {
    let runs = 0;
    const task = () => {
      runs++;
      if (runs === 1) enqueueForReconnect("push", task);
    };
    setOnline(false);
    enqueueForReconnect("push", task);

    setOnline(true);
    expect(runs).toBe(1);

    setOnline(false);
    setOnline(true);
    expect(runs).toBe(2);
  });

  it("stops replaying once torn down", () => {
    const task = jest.fn();
    setOnline(false);
    enqueueForReconnect("push", task);

    teardown();

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
