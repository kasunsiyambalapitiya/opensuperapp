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
import { Event } from "@/constants/enums/Event";
import { refreshAccessToken } from "@/services/tokenRefresh";
import { reachabilityEmitter } from "@/utils/eventEmitter";
import { loadAuthDataFromSecureStore } from "@/utils/authTokenStore";
import axios, { AxiosRequestConfig } from "axios";
import dayjs from "dayjs";
import { jwtDecode } from "jwt-decode";

// General API request handler
export const apiRequest = async (
  config: AxiosRequestConfig,
  onLogout: () => Promise<void>
) => {
  let accessToken = await getAccessToken(); // Get stored access token

  // If no access token, return early
  if (!accessToken) return;

  // Check if token is expired before making request
  if (isAccessTokenExpired(accessToken)) {
    const newAuthData = await refreshAccessToken(onLogout);

    if (!newAuthData?.accessToken) {
      return; // Logout is triggered inside refreshAccessToken
    }
    accessToken = newAuthData.accessToken;
  }

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

  try {
    const response = await axios(config); // Make the API request
    reachabilityEmitter.emit(Event.AuthReachability, true);
    return response;
  } catch (error: any) {
    // No `response` means the request never reached the backend, as opposed to reaching
    // it and being refused.
    if (!error.response) {
      reachabilityEmitter.emit(Event.AuthReachability, false);
    }

    if (error.response?.status === 401) {
      const newAuthData = await refreshAccessToken(onLogout);
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

// Helper function to check if the token is expired
const isAccessTokenExpired = (accessToken: string): boolean => {
  try {
    const decoded = jwtDecode<{ exp: number }>(accessToken);
    return dayjs.unix(decoded.exp).isBefore(dayjs());
  } catch {
    return true; // Assume expired if decoding fails
  }
};

// Helper function to get the stored access token. Exported for the call sites that opt into
// `x-user-assertion`, so they read the token from the same place this handler does.
export const getAccessToken = async (): Promise<string> => {
  const secureStore = await loadAuthDataFromSecureStore();
  if (!secureStore) return "";
  return secureStore?.accessToken || "";
};
