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

// Work that failed only because the device was offline, run again when it reconnects.
//
// Not a queue of HTTP requests, which is what the old branch kept: it wrote each failed
// request's headers, bearer token included, to AsyncStorage and replayed them blindly,
// stale token and all, whatever the method. Here a caller queues the call it would make
// again itself, so the replay goes through apiRequest with a current token. Only work
// that is safe to repeat belongs here; the caller is the one who knows whether it is.
//
// In memory on purpose: a restart reruns the app's start-up work anyway, and whatever
// was queued may no longer be wanted by then.
import { subscribeToConnectivity } from "@/utils/connectivity";

// Keyed, so a second failure of the same work replaces the first instead of doubling it.
const pending = new Map<string, () => void>();

/**
 * Run `task` on the next reconnect, in place of anything already queued under `key`.
 * A task that fails again can queue itself again.
 */
export const enqueueForReconnect = (key: string, task: () => void): void => {
  pending.set(key, task);
};

const replay = () => {
  const tasks = [...pending.values()];
  pending.clear();
  for (const task of tasks) {
    try {
      task();
    } catch (error) {
      console.error("Offline queue: replayed task failed", error);
    }
  }
};

/**
 * Start replaying queued work whenever the device comes back online.
 * @returns A function that stops it.
 */
export const setupOfflineQueueReplay = (): (() => void) =>
  subscribeToConnectivity((online) => {
    if (online) replay();
  });
