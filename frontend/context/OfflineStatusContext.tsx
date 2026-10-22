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
import { Event } from "@/constants/enums/Event";
import { useIsOnline } from "@/hooks/useIsOnline";
import { reachabilityEmitter } from "@/utils/eventEmitter";
import React, { createContext, useContext, useEffect, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";

export const OFFLINE_TITLE = "No internet connection";
export const OFFLINE_DETAIL = "Certain features might not work as expected.";
export const OFFLINE_MESSAGE = `${OFFLINE_TITLE}. ${OFFLINE_DETAIL}`;

const OfflineStatusContext = createContext(false);

/**
 * Tracks whether the device is offline, or the backend is out of reach right now.
 *
 * Held once at the root rather than in each toast: a toast that mounts later (a micro
 * app's, say) would otherwise miss a reachability failure reported before it existed.
 * Whether a toast is dismissed is each toast's own business.
 */
export const OfflineStatusProvider = ({ children }: { children: React.ReactNode }) => {
  const online = useIsOnline();
  const [unreachable, setUnreachable] = useState(false);
  const offline = !online || unreachable;

  useEffect(
    () =>
      reachabilityEmitter.on(Event.AuthReachability, (reachable) =>
        setUnreachable(!reachable)
      ),
    []
  );

  // A failure seen before a reconnect says nothing about the connection after it. Without
  // this the bar stays up until the next request happens to go out.
  useEffect(() => {
    if (online) {
      setUnreachable(false);
    }
  }, [online]);

  // accessibilityLiveRegion is Android only; VoiceOver has to be told. Announced here, not
  // per toast, so it is said once however many toasts are mounted.
  useEffect(() => {
    if (offline && Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(OFFLINE_MESSAGE);
    }
  }, [offline]);

  return (
    <OfflineStatusContext.Provider value={offline}>
      {children}
    </OfflineStatusContext.Provider>
  );
};

/** Whether the device is offline, or the backend is out of reach. */
export const useIsOffline = (): boolean => useContext(OfflineStatusContext);
