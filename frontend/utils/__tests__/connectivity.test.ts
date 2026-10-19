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
import { subscribeToConnectivity, waitForOnline } from "@/utils/connectivity";
import NetInfo from "@react-native-community/netinfo";

type Listener = (state: {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}) => void;

const listeners = new Set<Listener>();
const unsubscribes: jest.Mock[] = [];

beforeEach(() => {
  listeners.clear();
  unsubscribes.length = 0;
  (NetInfo.addEventListener as jest.Mock).mockClear().mockImplementation(
    (listener: Listener) => {
      listeners.add(listener);
      const unsubscribe = jest.fn(() => listeners.delete(listener));
      unsubscribes.push(unsubscribe);
      return unsubscribe;
    }
  );
});

const report = (
  isConnected: boolean | null,
  isInternetReachable: boolean | null = isConnected
) =>
  [...listeners].forEach((listener) =>
    listener({ isConnected, isInternetReachable })
  );

describe("subscribeToConnectivity", () => {
  it("reports online and offline as NetInfo sees them", () => {
    const seen: boolean[] = [];
    subscribeToConnectivity((online) => seen.push(online));

    report(true);
    report(false);

    expect(seen).toEqual([true, false]);
  });

  it("counts a radio with no route to the internet as offline", () => {
    const seen: boolean[] = [];
    subscribeToConnectivity((online) => seen.push(online));

    report(true, false);

    expect(seen).toEqual([false]);
  });

  // NetInfo reports null until its own probe has finished. Blocking on that would hold a
  // token refresh hostage to a probe that may never complete.
  it("counts an unknown connection or reachability as online", () => {
    const seen: boolean[] = [];
    subscribeToConnectivity((online) => seen.push(online));

    report(true, null);
    report(false);
    report(null, null);

    expect(seen).toEqual([true, false, true]);
  });

  it("only calls back when the answer changes", () => {
    const seen: boolean[] = [];
    subscribeToConnectivity((online) => seen.push(online));

    // A wifi-to-cellular handover is two NetInfo events and no change in connectivity.
    report(true);
    report(true);
    report(false);
    report(false);

    expect(seen).toEqual([true, false]);
  });

  it("returns NetInfo's unsubscribe", () => {
    const unsubscribe = subscribeToConnectivity(() => {});
    unsubscribe();

    expect(unsubscribes[0]).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });
});

describe("waitForOnline", () => {
  it("resolves straight away when already online", async () => {
    const waiting = waitForOnline();
    report(true);

    await expect(waiting).resolves.toBeUndefined();
    expect(listeners.size).toBe(0);
  });

  it("resolves when NetInfo answers synchronously on subscribe", async () => {
    (NetInfo.addEventListener as jest.Mock).mockImplementation(
      (listener: Listener) => {
        listener({ isConnected: true, isInternetReachable: true });
        const unsubscribe = jest.fn();
        unsubscribes.push(unsubscribe);
        return unsubscribe;
      }
    );

    await expect(waitForOnline()).resolves.toBeUndefined();
    expect(unsubscribes[0]).toHaveBeenCalledTimes(1);
  });

  it("waits through offline and resolves on reconnect", async () => {
    let settled = false;
    const waiting = waitForOnline().then(() => {
      settled = true;
    });

    report(false);
    await Promise.resolve();
    expect(settled).toBe(false);

    report(true);
    await waiting;
    expect(settled).toBe(true);
    expect(listeners.size).toBe(0);
  });

  it("does not wait on an unknown reachability", async () => {
    const waiting = waitForOnline();
    report(true, null);

    await expect(waiting).resolves.toBeUndefined();
  });

  it("gives up with an AbortError when the signal fires, and stops listening", async () => {
    const controller = new AbortController();
    const waiting = waitForOnline(controller.signal);
    report(false);

    controller.abort();

    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(listeners.size).toBe(0);
  });

  it("rejects at once on a signal that has already fired, without subscribing", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(waitForOnline(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(NetInfo.addEventListener).not.toHaveBeenCalled();
  });
});
