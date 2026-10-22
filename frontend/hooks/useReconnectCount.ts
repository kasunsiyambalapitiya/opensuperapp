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
import { useIsOnline } from "@/hooks/useIsOnline";
import { useEffect, useRef, useState } from "react";

/**
 * How many times the device has come back online since mount. Put it in an effect's deps
 * to run that effect again on reconnect: a load that ran offline does not come back on
 * its own, since nothing else it depends on changes. Starts at 0 and stays there while
 * the connection holds, so it adds no run on mount.
 */
export const useReconnectCount = (): number => {
  const isOnline = useIsOnline();
  const wasOnlineRef = useRef(isOnline);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (isOnline && !wasOnlineRef.current) {
      setCount((prev) => prev + 1);
    }
    wasOnlineRef.current = isOnline;
  }, [isOnline]);

  return count;
};
