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
// This is the radio's opinion, so it can say online behind a captive portal. What it is
// good for is the other direction: when it says offline, there is no point trying.
import NetInfo, { NetInfoState } from "@react-native-community/netinfo";

// NetInfo answers null for "not found out yet". Only a definite false counts as offline,
// so nothing ever waits on a probe that has not finished, or never will.
const isOnline = ({
  isConnected,
  isInternetReachable,
}: Pick<NetInfoState, "isConnected" | "isInternetReachable">): boolean =>
  isConnected !== false && isInternetReachable !== false;

const abortError = (): Error => {
  const error = new Error("Stopped waiting for a connection");
  error.name = "AbortError";
  return error;
};

/**
 * Calls `listener` with the current connectivity as soon as NetInfo knows it, then on
 * every change. NetInfo fires on things that do not change the answer, such as a wifi to
 * cellular handover; those are dropped here.
 * @returns A function that unsubscribes.
 */
export const subscribeToConnectivity = (
  listener: (online: boolean) => void
): (() => void) => {
  let last: boolean | undefined;
  return NetInfo.addEventListener((state) => {
    const online = isOnline(state);
    if (online === last) return;
    last = online;
    listener(online);
  });
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
