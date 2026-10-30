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
import { selectHasSessionEnded } from "@/context/slices/authSlice";
import { useEffect, useRef } from "react";
import { useSelector } from "react-redux";

/**
 * Calls `leave` once the session has expired or been signed out, for a screen that has
 * no Sign In fallback of its own and is dead without a session. Also on opening such a
 * screen without one.
 *
 * Restoring is not an ending: on a cold start nothing is decided until the stored
 * session has been read, so nothing flickers away.
 */
export const useLeaveWhenSessionEnds = (leave: () => void) => {
  const hasEnded = useSelector(selectHasSessionEnded);
  // Kept current without being a dependency, so a screen passing a fresh closure on
  // every render still leaves once per ending, not once per render.
  const leaveRef = useRef(leave);
  leaveRef.current = leave;

  useEffect(() => {
    if (hasEnded) leaveRef.current();
  }, [hasEnded]);
};
