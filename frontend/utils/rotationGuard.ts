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

// Refresh tokens rotate: Asgardeo invalidates the one we sent the moment it
// receives the POST, so a response lost in flight leaves us holding a dead
// token and the next refresh gets a 400 invalid_grant on a session that did
// nothing wrong. A marker written when a refresh POST fails without a response
// is the only evidence that tells that case apart from a genuine expiry.
import { REFRESH_INTERRUPTED_KEY } from "@/constants/Constants";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type InterruptedRefresh = { interruptedAt: number };

export const readInterruptedRefresh =
  async (): Promise<InterruptedRefresh | null> => {
    let raw: string | null;
    try {
      raw = await AsyncStorage.getItem(REFRESH_INTERRUPTED_KEY);
    } catch (error) {
      console.error("Error reading the interrupted-refresh marker:", error);
      return null;
    }

    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.interruptedAt === "number") {
        return { interruptedAt: parsed.interruptedAt };
      }
    } catch {
      // Unreadable; cleared below.
    }

    // A marker we can't read would keep claiming an interruption we can't date.
    await clearInterruptedRefresh();
    return null;
  };

/** Call when a refresh POST throws or times out: R1 may already be consumed. */
export const markRefreshInterrupted = async (
  now: number = Date.now()
): Promise<void> => {
  try {
    // The oldest interruption is the one that explains the eventual logout.
    const existing = await AsyncStorage.getItem(REFRESH_INTERRUPTED_KEY);
    if (existing) return;

    await AsyncStorage.setItem(
      REFRESH_INTERRUPTED_KEY,
      JSON.stringify({ interruptedAt: now })
    );
  } catch (error) {
    console.error("Error marking the refresh as interrupted:", error);
  }
};

/**
 * Call once the token on disk is known good again, or once the session has ended.
 * Deliberately NOT called for every response that arrives: a 5xx says nothing
 * about whether the server already consumed the token, so the marker outlives it.
 */
export const clearInterruptedRefresh = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(REFRESH_INTERRUPTED_KEY);
  } catch (error) {
    console.error("Error clearing the interrupted-refresh marker:", error);
  }
};
