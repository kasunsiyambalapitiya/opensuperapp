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

// Whether the device has a connection, as NetInfo sees it.
//
// This is the radio's opinion, so it can say online behind a captive portal. Its offline
// is not final either: on iOS, NetInfo can miss the connection coming back (always on the
// Simulator) and then says offline forever, so while it does, the network is probed too.
import NetInfo, { NetInfoState } from "@react-native-community/netinfo";

// NetInfo answers null for "not found out yet". Only a definite false counts as offline,
// so nothing ever waits on a probe that has not finished, or never will.
const isOnline = ({
  isConnected,
  isInternetReachable,
}: Pick<NetInfoState, "isConnected" | "isInternetReachable">): boolean =>
  isConnected !== false && isInternetReachable !== false;

// When the device last came back online, as any subscriber saw it. The root banner is
// always subscribed, so in practice this tracks every reconnect.
let lastReconnectAt = 0;

/**
 * Whether something that started at `startedAt` (a `Date.now()` value) began before the
 * latest reconnect. A request sent into a dead network can fail well after the network is
 * back, and its failure then says nothing about the connection as it is now.
 */
export const startedBeforeReconnect = (startedAt: number): boolean =>
  startedAt < lastReconnectAt;

const abortError = (): Error => {
  const error = new Error("Stopped waiting for a connection");
  error.name = "AbortError";
  return error;
};

// The URL NetInfo itself probes with. Any answer at all means there is a route out.
const PROBE_URL = "https://clients3.google.com/generate_204";
const PROBE_INTERVAL_MS = 5000;
const PROBE_TIMEOUT_MS = 3000;

const probe = async (): Promise<boolean> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetch(PROBE_URL, {
      method: "HEAD",
      cache: "no-store",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Calls `listener` with the current connectivity as soon as NetInfo knows it, then on
 * every change. NetInfo fires on things that do not change the answer, such as a wifi to
 * cellular handover; those are dropped here.
 *
 * While NetInfo says offline, the network is probed every few seconds as well, and the
 * first probe to get through reports online: NetInfo on iOS can stay silent when the
 * connection returns.
 * @returns A function that unsubscribes.
 */
export const subscribeToConnectivity = (
  listener: (online: boolean) => void
): (() => void) => {
  let last: boolean | undefined;
  let probing = false;
  let probeTimer: ReturnType<typeof setTimeout> | undefined;
  // Bumped on every stop, so a probe still out from an earlier round is ignored.
  let round = 0;

  const report = (online: boolean) => {
    if (online === last) return;
    if (online && last === false) lastReconnectAt = Date.now();
    last = online;
    listener(online);
  };

  const stopProbing = () => {
    probing = false;
    round += 1;
    clearTimeout(probeTimer);
  };

  // Each probe is scheduled only after the last one has finished, so a slow network never
  // has several in flight.
  const scheduleProbe = (myRound: number) => {
    probeTimer = setTimeout(async () => {
      const reachable = await probe();
      if (myRound !== round) return;
      if (reachable) {
        stopProbing();
        report(true);
      } else {
        scheduleProbe(myRound);
      }
    }, PROBE_INTERVAL_MS);
  };

  const unsubscribe = NetInfo.addEventListener((state) => {
    const online = isOnline(state);
    if (online) {
      stopProbing();
    } else if (!probing) {
      probing = true;
      scheduleProbe(round);
    }
    report(online);
  });

  return () => {
    stopProbing();
    unsubscribe();
  };
};

/**
 * Resolves once the device is online, at once if it already is. Rejects with an
 * `AbortError` if `signal` fires first, so a caller can put a bound on the wait.
 */
export const waitForOnline = (signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    let unsubscribe: (() => void) | undefined;
    let settled = false;
    const settle = (finish: () => void) => {
      settled = true;
      unsubscribe?.();
      signal?.removeEventListener("abort", onAbort);
      finish();
    };
    const onAbort = () => settle(() => reject(abortError()));

    signal?.addEventListener("abort", onAbort);
    unsubscribe = subscribeToConnectivity((online) => {
      if (online && !settled) settle(resolve);
    });
    // NetInfo may answer inside addEventListener, before there was anything to unsubscribe.
    if (settled) unsubscribe();
  });
