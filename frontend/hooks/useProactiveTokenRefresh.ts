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
import { selectIsSignedIn } from "@/context/slices/authSlice";
import { RootState } from "@/context/store";
import { useIsOnline } from "@/hooks/useIsOnline";
import { refreshAccessToken } from "@/services/tokenRefresh";
import { refreshDueAt, shouldRefreshToken } from "@/utils/tokenExpiry";
import { useEffect } from "react";
import { AppState } from "react-native";
import { useSelector, useStore } from "react-redux";

// iOS reports "active" again after every Face ID prompt, permission dialog and pull of
// the notification shade. Those are not returns from the background, and a token that
// cannot be read is always due, so each one would otherwise be another refresh.
const FOREGROUND_CHECK_COOLDOWN_MS = 30 * 1000;
// The backstop for a timer that fired late or not at all (iOS suspends JS in the
// background, Android dozes), and the retry for a refresh that failed: a one-hour token
// has 12 minutes between its refresh point and its expiry, which this fits twice into.
const PERIODIC_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Renews the access token before it expires, so a request rarely has to wait on a
 * refresh, or fail because one could not happen. Mount it once, in the root layout.
 *
 * Nothing runs while signed out or offline; reconnecting checks at once. Overlapping
 * checks are harmless because `refreshAccessToken` shares one refresh between callers.
 */
export const useProactiveTokenRefresh = () => {
  const store = useStore<RootState>();
  const isSignedIn = useSelector(selectIsSignedIn);
  const isOnline = useIsOnline();
  const accessToken = useSelector((state: RootState) => state.auth.accessToken);
  const isWatching = isSignedIn && isOnline;

  // On sign-in and on reconnect, then on returning to the foreground and every few
  // minutes. Not on a new token: a token that is due the moment it arrives, from a device
  // clock well ahead of the server's, would otherwise be refreshed back to back.
  useEffect(() => {
    if (!isWatching) return;

    // Read at check time rather than closed over, so a new token does not restart this.
    const check = () => {
      if (shouldRefreshToken(store.getState().auth.accessToken)) {
        refreshAccessToken();
      }
    };

    check();
    let lastForegroundCheckAt = Date.now();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (Date.now() - lastForegroundCheckAt < FOREGROUND_CHECK_COOLDOWN_MS) {
        return;
      }
      lastForegroundCheckAt = Date.now();
      check();
    });
    const interval = setInterval(check, PERIODIC_CHECK_INTERVAL_MS);

    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, [isWatching, store]);

  // A timer for the moment this token falls due. One that is due already is left to the
  // checks above.
  useEffect(() => {
    if (!isWatching) return;

    const delay = refreshDueAt(accessToken) - Date.now();
    if (delay <= 0) return;

    const timer = setTimeout(refreshAccessToken, delay);
    return () => clearTimeout(timer);
  }, [isWatching, accessToken]);
};
