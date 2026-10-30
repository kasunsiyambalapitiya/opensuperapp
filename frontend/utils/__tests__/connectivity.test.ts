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
  startedBeforeReconnect,
  subscribeToConnectivity,
  waitForOnline,
} from "@/utils/connectivity";
import NetInfo from "@react-native-community/netinfo";

type Listener = (state: {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}) => void;

const listeners = new Set<Listener>();
const unsubscribes: jest.Mock[] = [];
const fetchMock = jest.fn();

beforeEach(() => {
  jest.useFakeTimers();
  // Offline by default: a probe that gets through is opted into per test.
  fetchMock
    .mockReset()
    .mockRejectedValue(new TypeError("Network request failed"));
  global.fetch = fetchMock;
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

  // The iOS Simulator, and sometimes a device, never tells NetInfo the connection is back.
  describe("while NetInfo says offline", () => {
    const PROBE_INTERVAL_MS = 5000;

    // Lets a probe's fetch settle and the callback after it run.
    const tick = async (ms: number) => {
      await jest.advanceTimersByTimeAsync(ms);
    };

    it("reports online once a probe gets through, though NetInfo stays silent", async () => {
      const seen: boolean[] = [];
      subscribeToConnectivity((online) => seen.push(online));
      report(false);

      await tick(PROBE_INTERVAL_MS);
      expect(seen).toEqual([false]);

      fetchMock.mockResolvedValue({ status: 204 });
      await tick(PROBE_INTERVAL_MS);

      expect(seen).toEqual([false, true]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("stops probing once online", async () => {
      fetchMock.mockResolvedValue({ status: 204 });
      subscribeToConnectivity(() => {});
      report(false);

      await tick(PROBE_INTERVAL_MS);
      await tick(PROBE_INTERVAL_MS * 3);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("never probes while NetInfo says online", async () => {
      subscribeToConnectivity(() => {});
      report(true);

      await tick(PROBE_INTERVAL_MS * 3);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("drops a probe still out when NetInfo reports the reconnect itself", async () => {
      let answer!: (value: unknown) => void;
      fetchMock.mockReturnValue(new Promise((resolve) => (answer = resolve)));
      const seen: boolean[] = [];
      subscribeToConnectivity((online) => seen.push(online));
      report(false);
      await tick(PROBE_INTERVAL_MS);

      report(true);
      report(false);
      answer({ status: 204 });
      await tick(0);

      // The late probe belonged to the first outage; the second is still on.
      expect(seen).toEqual([false, true, false]);
    });

    it("stops probing on unsubscribe", async () => {
      const unsubscribe = subscribeToConnectivity(() => {});
      report(false);
      unsubscribe();

      await tick(PROBE_INTERVAL_MS * 3);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("lets waitForOnline resolve on a probe", async () => {
      const waiting = waitForOnline();
      report(false);

      fetchMock.mockResolvedValue({ status: 204 });
      await tick(PROBE_INTERVAL_MS);

      await expect(waiting).resolves.toBeUndefined();
      expect(listeners.size).toBe(0);
    });
  });

  it("returns NetInfo's unsubscribe", () => {
    const unsubscribe = subscribeToConnectivity(() => {});
    unsubscribe();

    expect(unsubscribes[0]).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });
});

describe("startedBeforeReconnect", () => {
  it("is true only for what started before the device last came back online", () => {
    subscribeToConnectivity(() => {});
    report(true);
    report(false);
    const sentWhileOffline = Date.now();

    jest.advanceTimersByTime(1000);
    report(true);
    const sentAfterReconnect = Date.now();

    expect(startedBeforeReconnect(sentWhileOffline)).toBe(true);
    expect(startedBeforeReconnect(sentAfterReconnect)).toBe(false);
  });

  // Nothing was lost on startup, so a failure from just before it still counts.
  it("does not count the first answer as a reconnect", () => {
    // The last reconnect is module state, so step past any an earlier test recorded.
    jest.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
    const sentBeforeFirstAnswer = Date.now();
    jest.advanceTimersByTime(1000);
    subscribeToConnectivity(() => {});
    report(true);

    expect(startedBeforeReconnect(sentBeforeFirstAnswer)).toBe(false);
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
