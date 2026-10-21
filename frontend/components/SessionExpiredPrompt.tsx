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
import SignInModal from "@/components/SignInModal";
import { selectSessionStatus } from "@/context/slices/authSlice";
import { RootState } from "@/context/store";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";

const EXPIRED_COPY = {
  title: "Session expired",
  message: "Your session has expired. Sign in again to keep using your apps.",
};

const ROTATION_LOST_COPY = {
  title: "You've been signed out",
  message:
    "We lost your sign-in while the connection was down. Sign in again to keep using your apps.",
};

/**
 * Asks the user to sign in again the moment their session expires, wherever they are.
 * Before this the only way back was a Sign In button on Profile or the Store, and
 * nothing said to go there.
 *
 * Mounted once at the root. A user-initiated sign-out never shows it, and "Not now"
 * leaves the user signed out with the usual Sign In buttons where they always were.
 */
const SessionExpiredPrompt = () => {
  const isExpired = useSelector(selectSessionStatus) === "expired";
  const rotationLost = useSelector(
    (state: RootState) => state.auth.rotationLost
  );
  // A sign-in started while the expired session is still being cleared would be cleared
  // with it.
  const isEndingSession = useSelector(
    (state: RootState) => state.auth.isEndingSession
  );
  const [dismissed, setDismissed] = useState(false);

  // Cleared on the way into an expiry rather than on the way out: iOS reports the modal
  // dismissed only after its animation, by which time a sign-in has already hidden it.
  useEffect(() => {
    if (isExpired) setDismissed(false);
  }, [isExpired]);

  const { title, message } = rotationLost ? ROTATION_LOST_COPY : EXPIRED_COPY;

  return (
    <SignInModal
      visible={isExpired && !isEndingSession && !dismissed}
      onClose={() => setDismissed(true)}
      title={title}
      message={message}
      dismissLabel="Not now"
    />
  );
};

export default SessionExpiredPrompt;
