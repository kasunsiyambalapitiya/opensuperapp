// Copyright (c) 2025 WSO2 LLC. (https://www.wso2.com).
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
import { API_REQUEST_TIMEOUT_MS } from "@/constants/Constants";
import { Event } from "@/constants/enums/Event";
import { refreshAccessToken } from "@/services/tokenRefresh";
import { startedBeforeReconnect } from "@/utils/connectivity";
import { reachabilityEmitter } from "@/utils/eventEmitter";
import { loadAuthDataFromSecureStore } from "@/utils/authTokenStore";
import { isTokenExpired } from "@/utils/tokenExpiry";
import axios, { AxiosRequestConfig } from "axios";

// General API request handler
export const apiRequest = async (config: AxiosRequestConfig) => {
  let accessToken = await getAccessToken(); // Get stored access token

  // If no access token, return early
  if (!accessToken) return;

  // Expiry, not the earlier refresh point: if a proactive refresh has failed, a token
  // that still works is better sent than held back.
  if (isTokenExpired(accessToken)) {
    const newAuthData = await refreshAccessToken();

    if (!newAuthData?.accessToken) {
      return; // refreshAccessToken has already reported the session's state
    }
    accessToken = newAuthData.accessToken;
  }

  // A timeout rejects with no `response`, so it reads below as unreachable, never as a
  // verdict on the session.
  config.timeout = config.timeout ?? API_REQUEST_TIMEOUT_MS;

  // Set Authorization Header
  //
  // An API gateway in front of the service overwrites `x-jwt-assertion` with a JWT it mints
  // itself, so the client's own access token cannot be carried there. It travels in
  // `x-user-assertion`, which the gateway passes through untouched. Only the endpoints that
  // need to call a downstream service with the caller's token read it, so the call site opts
  // in (see services/walletPassService.ts) rather than every request carrying a second,
  // unredacted copy of the token.
  config.headers = {
    ...config.headers,
    Authorization: `Bearer ${accessToken}`,
  };

  // The backend reads `x-user-assertion` in preference to `Authorization`, so an opted-in
  // value the caller set before the refresh above would override the fresh bearer token with
  // the one this handler has just replaced.
  if (config.headers["x-user-assertion"]) {
    config.headers["x-user-assertion"] = accessToken;
  }

  if (__DEV__) {
    config.headers["x-jwt-assertion"] = accessToken;
  }

  const startedAt = Date.now();
  try {
    const response = await axios(config); // Make the API request
    reachabilityEmitter.emit(Event.AuthReachability, true);
    return response;
  } catch (error: any) {
    // No `response` means the request never reached the backend, as opposed to reaching
    // it and being refused. One sent before the latest reconnect proves nothing about now.
    if (!error.response && !startedBeforeReconnect(startedAt)) {
      reachabilityEmitter.emit(Event.AuthReachability, false);
    }

    if (error.response?.status === 401) {
      const newAuthData = await refreshAccessToken();
      if (newAuthData?.accessToken) {
        // Retry the request with the new token
        config.headers.Authorization = `Bearer ${newAuthData.accessToken}`;
        if (config.headers["x-user-assertion"]) {
          config.headers["x-user-assertion"] = newAuthData.accessToken;
        }
        if (__DEV__) {
          config.headers["x-jwt-assertion"] = newAuthData.accessToken;
        }

        try {
          return await axios(config);
        } catch (retryError: any) {
          // 401 after refresh: Likely another issue, not token expiration
          throw retryError;
        }
      }
    }

    throw error;
  }
};

// Helper function to get the stored access token. Exported for the call sites that opt into
// `x-user-assertion`, so they read the token from the same place this handler does.
export const getAccessToken = async (): Promise<string> => {
  const secureStore = await loadAuthDataFromSecureStore();
  if (!secureStore) return "";
  return secureStore?.accessToken || "";
};
