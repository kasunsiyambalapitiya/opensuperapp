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
import { setAuth, setSessionStatus } from "@/context/slices/authSlice";
import { AppDispatch } from "@/context/store";
import { endSession } from "@/utils/endSession";
import { authEmitter } from "@/utils/eventEmitter";
import { useEffect } from "react";
import { useDispatch } from "react-redux";

/**
 * The single place that decides what a token refresh's outcome means for the app.
 * Mount it once, in the root layout: a refresh can start from any screen, and before
 * this there were nine callers each passing in their own idea of a logout.
 */
export const useSessionListener = () => {
  const dispatch = useDispatch<AppDispatch>();

  useEffect(
    () =>
      authEmitter.on(Event.AuthSession, (signal) => {
        switch (signal.status) {
          case "authenticated":
            dispatch(setAuth(signal.authData));
            return;
          case "expired":
            dispatch(endSession("expired"));
            return;
          default:
            dispatch(setSessionStatus(signal.status));
        }
      }),
    [dispatch]
  );
};
