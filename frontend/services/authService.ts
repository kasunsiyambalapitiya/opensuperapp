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
import { CLIENT_ID, SUCCESS, TOKEN_URL } from "@/constants/Constants";
import { Event } from "@/constants/enums/Event";
import {
  updateExchangedIdToken,
  updateExchangedToken,
} from "@/context/slices/appSlice";
import { AppDispatch } from "@/context/store";
import { refreshAccessToken } from "@/services/tokenRefresh";
import { AppScope } from "@/types/appConfig.types";
import { AuthData, DecodedIdToken } from "@/types/auth.types";
import createAuthRequestBody from "@/utils/authBody";
import {
  loadAuthDataFromSecureStore,
  saveAuthDataToSecureStore,
  SecureAuthData,
} from "@/utils/authTokenStore";
import { reachabilityEmitter } from "@/utils/eventEmitter";
import { clearInterruptedRefresh } from "@/utils/rotationGuard";
import { isTokenExpired } from "@/utils/tokenExpiry";
import axios from "axios";
import { jwtDecode } from "jwt-decode";
import { AuthorizeResult } from "react-native-app-auth";

// Re-exported so the many existing importers of these shapes do not have to move.
export type { AuthData, DecodedIdToken };
export { isTokenExpired };

const GRANT_TYPE_AUTHORIZATION_CODE = "authorization_code";
const GRANT_TYPE_TOKEN_EXCHANGE =
  "urn:ietf:params:oauth:grant-type:token-exchange";
const SUBJECT_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:jwt";
const REQUESTED_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
const MILLISECONDS_IN_A_SECOND = 1000;
const SCOPE = "openid email groups profile";


export const getAccessToken = async (
  request: any,
  result: any,
  redirectUri: string
): Promise<AuthData | null> => {
  if (result?.type === SUCCESS && result.params?.code) {
    try {
      if (!TOKEN_URL) {
        throw new Error(
          "TOKEN_URL is not defined. Check your environment variables."
        );
      }

      const requestBody = createAuthRequestBody({
        grantType: GRANT_TYPE_AUTHORIZATION_CODE,
        code: result.params.code,
        redirectUri,
        clientId: CLIENT_ID,
        codeVerifier: request?.codeVerifier,
      });

      const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: requestBody,
      });

      const data = await response.json();

      if (data.access_token && data.id_token) {
        const decodedIdToken = jwtDecode<DecodedIdToken>(data.id_token);
        const { email, userid: userId } = decodedIdToken;
        const exp = jwtDecode(data.access_token).exp || 0;

        const authData: AuthData = {
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          idToken: data.id_token,
          email,
          userId,
          expiresAt: exp * MILLISECONDS_IN_A_SECOND,
        };

        await saveAuthDataToSecureStore(authData as SecureAuthData); // Persist data
        return authData;
      }
    } catch (err) {
      console.error("Login error:", err);
      return null;
    }
  }
  return null;
};

// Restore auth data form secure storage
export const loadAuthData = async (): Promise<AuthData | null> => {
  const secureData = await loadAuthDataFromSecureStore();
  return secureData ? (secureData as AuthData) : null;
};

export type TokenExchangeResult = {
  accessToken?: string;
  idToken?: string;
};

// token exchange
export const tokenExchange = async (
  dispatch: AppDispatch,
  clientId: string,
  exchangedToken: string,
  exchangedIdToken: string,
  appId: string,
  appScopes?: AppScope[]
): Promise<TokenExchangeResult | null> => {
  try {
    // Find and append app specific scopes if available
    const appScope = appScopes?.find((scope) => scope.appId === appId);
    const selectedScopes = appScope ? `${SCOPE} ${appScope.scopes}` : SCOPE;

    if (!clientId || clientId === "CLIENT_ID") return null;

    // Use existing exchanged tokens if they're still valid
    if (
      exchangedToken &&
      !isTokenExpired(exchangedToken) &&
      exchangedIdToken &&
      !isTokenExpired(exchangedIdToken)
    ) {
      return { accessToken: exchangedToken, idToken: exchangedIdToken };
    }

    // Retrieve stored authentication data
    const secureData = await loadAuthDataFromSecureStore();
    if (!secureData?.accessToken) {
      console.error("No stored authentication data found.");
      return null;
    }

    let accessToken = secureData.accessToken;
    if (!accessToken) {
      console.error("No access token found in stored authentication data.");
      return null;
    }

    if (!TOKEN_URL) {
      throw new Error(
        "TOKEN_URL is not defined. Check your environment variables."
      );
    }

    // Refresh access token if expired
    if (isTokenExpired(accessToken)) {
      const newAuthData = await refreshAccessToken();
      if (!newAuthData?.accessToken) {
        return null; // refreshAccessToken has already reported the session's state
      }
      accessToken = newAuthData.accessToken;
    }

    // Function to attempt token exchange, with retry on 401 error
    const attemptTokenExchange = async (token: string) => {
      try {
        const response = await axios.post(
          TOKEN_URL,
          createAuthRequestBody({
            clientId,
            grantType: GRANT_TYPE_TOKEN_EXCHANGE,
            subjectToken: token,
            subjectTokenType: SUBJECT_TOKEN_TYPE,
            requestedTokenType: REQUESTED_TOKEN_TYPE,
            scope: selectedScopes,
          }),
          {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
          }
        );

        // Any response at all proves the backend is reachable.
        reachabilityEmitter.emit(Event.AuthReachability, true);

        if (response.status === 200) return response.data;

        if (response.status === 401) {
          console.warn(
            "Token exchange failed with 401. Attempting token refresh..."
          );
          const newAuthData = await refreshAccessToken();

          if (!newAuthData?.accessToken) {
            return null; // refreshAccessToken has already reported the session's state
          }

          return attemptTokenExchange(newAuthData.accessToken);
        } else {
          console.error(
            `Token exchange failed: ${response.status} - ${response.data}`
          );
          return null;
        }
      } catch (error: any) {
        console.error("Fetch error:", error);
        // No Alert: the micro-app screen, the only caller, says so and offers "Try again".
        reachabilityEmitter.emit(
          Event.AuthReachability,
          Boolean(error.response)
        );
        return null;
      }
    };

    // Attempt token exchange
    const data = await attemptTokenExchange(accessToken);

    if (!data?.access_token) {
      console.error("Token exchange response does not contain access_token.");
      return null;
    }

    dispatch(
      updateExchangedToken({ appId, exchangedToken: data.access_token })
    );

    if (data.id_token) {
      dispatch(
        updateExchangedIdToken({ appId, exchangedIdToken: data.id_token })
      );
    }

    return { accessToken: data.access_token, idToken: data.id_token };
  } catch (error) {
    console.error("Error during token exchange:", error);
    return null;
  }
};

/**
 * Process authentication data from react-native-app-auth
 */
export const processNativeAuthResult = async (
  authResult: AuthorizeResult
): Promise<AuthData | null> => {
  try {
    if (authResult.accessToken && authResult.idToken) {
      const decodedIdToken = jwtDecode<DecodedIdToken>(authResult.idToken);
      const exp = jwtDecode<{ exp: number }>(authResult.accessToken).exp || 0;
      const { email, userid: userId } = decodedIdToken;

      const authData: AuthData = {
        accessToken: authResult.accessToken,
        refreshToken: authResult.refreshToken,
        idToken: authResult.idToken,
        email: email,
        userId,
        expiresAt: exp * MILLISECONDS_IN_A_SECOND,
      };

      await saveAuthDataToSecureStore(authData as SecureAuthData);
      // A new session: an interrupted refresh from the last one says nothing about it.
      await clearInterruptedRefresh();
      return authData;
    } else {
      console.error("Missing required tokens in auth result");
      return null;
    }
  } catch (err) {
    console.error("Error processing native auth result:", err);
    return null;
  }
};
