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

// Renewing the access token, and deciding what a failure to renew it means.
//
// The rule everything here turns on: only a refresh token the server has provably
// rejected may end a session. No signal, a slow socket, a 5xx, a captive portal's HTML
// login page - none of those say anything about whether the user is still signed in.
import { CLIENT_ID, TOKEN_URL } from "@/constants/Constants";
import { Event } from "@/constants/enums/Event";
import { AuthData, DecodedIdToken } from "@/types/auth.types";
import createAuthRequestBody from "@/utils/authBody";
import {
  AuthError,
  classifyAuthError,
  isRetryable,
  OAuthErrorBody,
  retryWithBackoff,
} from "@/utils/authErrors";
import {
  loadAuthDataFromSecureStore,
  saveAuthDataToSecureStore,
  SecureAuthData,
} from "@/utils/authTokenStore";
import {
  clearInterruptedRefresh,
  markRefreshInterrupted,
  readInterruptedRefresh,
} from "@/utils/rotationGuard";
import { waitForOnline } from "@/utils/connectivity";
import { authEmitter, reachabilityEmitter } from "@/utils/eventEmitter";
import { jwtDecode } from "jwt-decode";

const GRANT_TYPE_REFRESH_TOKEN = "refresh_token";
const MILLISECONDS_IN_A_SECOND = 1000;

// A half-dead connection can leave a fetch hanging until the OS gives up, which on mobile
// can be minutes, and every screen that wants a token waits behind `refreshPromise`.
const TOKEN_REFRESH_TIMEOUT_MS = 15000;
// Attempts wait out an offline stretch rather than fail against a dead radio, but every
// screen that wants a token waits behind the same refresh, so each wait is bounded.
const OFFLINE_WAIT_TIMEOUT_MS = 30000;

let refreshPromise: Promise<AuthData | null> | null = null;

// A set the server issued that SecureStore would not take. The server has already
// rotated the token on disk away, so the next refresh has to send this one instead.
// Keyed on the disk token it replaces: once that changes - signed out, or signed in
// again - this belongs to a session that is over.
let unsaved: { replaces: string; authData: AuthData } | null = null;

/** Drops tokens held only in memory. Called when a session ends. */
export const forgetUnsavedTokens = (): void => {
  unsaved = null;
};

const loadLatestAuthData = async (): Promise<{
  diskRefreshToken: string | undefined;
  authData: AuthData | null;
}> => {
  const onDisk = await loadAuthDataFromSecureStore();
  const diskRefreshToken = onDisk?.refreshToken;
  if (unsaved && unsaved.replaces !== diskRefreshToken) unsaved = null;
  return { diskRefreshToken, authData: unsaved?.authData ?? onDisk };
};

type TokenResponse = {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
};

/** A token response that carried what a refresh has to carry to be worth anything. */
type IssuedTokens = TokenResponse & { access_token: string; id_token: string };

// A 400 that is not `invalid_grant` is a malformed request - a proxy rewriting the body,
// say - and is worth another attempt. A 401/403/404 here is a misconfiguration, and
// retrying only delays finding that out.
const shouldRetryRefresh = (err: unknown): boolean => {
  if (!(err instanceof AuthError)) return false;
  if (err.kind === "invalid_grant") return false;
  return isRetryable(err.kind) || err.status === 400;
};

const readOAuthErrorBody = async (
  response: Response
): Promise<OAuthErrorBody | null> => {
  try {
    return (await response.json()) as OAuthErrorBody;
  } catch {
    // A captive portal answers with HTML and a proxy can truncate the body; the status
    // is then the only thing left to go on.
    return null;
  }
};

// One attempt. Anything short of a usable token set leaves here as an `AuthError`, so the
// retry policy has a single thing to reason about.
const postRefreshToken = async (
  refreshToken: string
): Promise<IssuedTokens> => {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    TOKEN_REFRESH_TIMEOUT_MS
  );

  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: createAuthRequestBody({
        grantType: GRANT_TYPE_REFRESH_TOKEN,
        clientId: CLIENT_ID,
        refreshToken,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    const kind = classifyAuthError({ error: err });
    // Nothing came back, so the server may already have rotated this token away and sent
    // the replacement into a dead connection.
    if (kind === "network" || kind === "timeout") {
      await markRefreshInterrupted();
    }
    throw new AuthError(kind, "Token refresh request did not complete", {
      cause: err,
    });
  } finally {
    clearTimeout(timeout);
  }

  // Any response, of any status, proves the backend is reachable.
  reachabilityEmitter.emit(Event.AuthReachability, true);

  if (!response.ok) {
    const body = await readOAuthErrorBody(response);
    throw new AuthError(
      classifyAuthError({ status: response.status, body }),
      `Token refresh failed: ${response.status} ${response.statusText}`,
      { status: response.status, oauthError: body?.error }
    );
  }

  let data: TokenResponse;
  try {
    data = (await response.json()) as TokenResponse;
  } catch (err) {
    // 200 with an unreadable body is a proxy or a truncated read, not a verdict on the
    // session, so it is the server's fault and the attempt is retried.
    throw new AuthError("server", "Token response was not valid JSON", {
      status: response.status,
      cause: err,
    });
  }

  const { access_token, id_token } = data;
  if (!access_token || !id_token) {
    throw new AuthError("server", "Token response was missing tokens", {
      status: response.status,
    });
  }

  return { ...data, access_token, id_token };
};

// The claims are a convenience; the tokens are the thing. A 200 means the server may have
// just rotated the old refresh token away, so a set we have been issued must never be
// discarded over a JWT we could not read. An unreadable set stores an expiry of 0, which
// reads as expired, so the next call refreshes again with the token we did keep.
const readIssuedClaims = (
  data: IssuedTokens
): Pick<AuthData, "email" | "userId" | "expiresAt"> => {
  try {
    const { email, userid: userId } = jwtDecode<DecodedIdToken>(data.id_token);
    const exp = jwtDecode<{ exp: number }>(data.access_token).exp || 0;
    return { email, userId, expiresAt: exp * MILLISECONDS_IN_A_SECOND };
  } catch (err) {
    console.error("Token refresh: issued tokens could not be decoded", err);
    return { expiresAt: 0 };
  }
};

// Rejects with an AbortError, which classifies as a timeout: retried no further, and never
// a reason to end the session.
const waitForOnlineWithinBound = async (): Promise<void> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OFFLINE_WAIT_TIMEOUT_MS);
  try {
    await waitForOnline(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
};

// Whether a refresh that ran out of attempts ends the session, and why.
const handleRefreshFailure = async (err: unknown): Promise<null> => {
  const kind =
    err instanceof AuthError ? err.kind : classifyAuthError({ error: err });
  console.error(
    `Token refresh failed (${kind}):`,
    err instanceof Error ? err.message : err
  );

  if (kind !== "invalid_grant") {
    // Said only once the retries are spent, so a single blip does not flicker the banner.
    if (kind === "network" || kind === "timeout") {
      reachabilityEmitter.emit(Event.AuthReachability, false);
    }
    authEmitter.emit(Event.AuthSession, { status: "degraded" });
    return null;
  }

  // An earlier refresh sent this token and never saw the reply: the server rotated it
  // away and the replacement never arrived. Not recoverable, but not an ordinary expiry
  // either, and the sign-in prompt says so rather than dropping the user without a word.
  const rotationLost = Boolean(await readInterruptedRefresh());

  await clearInterruptedRefresh();
  authEmitter.emit(Event.AuthSession, { status: "expired", rotationLost });
  return null;
};

export const refreshAccessToken = async (): Promise<AuthData | null> => {
  if (refreshPromise) {
    return refreshPromise; // If a refresh is already in progress, return the same promise
  }

  refreshPromise = (async () => {
    try {
      const { diskRefreshToken, authData: storedData } =
        await loadLatestAuthData();
      if (!diskRefreshToken || !storedData?.refreshToken) return null;

      if (!TOKEN_URL) {
        console.error(
          "TOKEN_URL is not defined. Check your environment variables."
        );
        return null;
      }

      authEmitter.emit(Event.AuthSession, { status: "refreshing" });
      let data: IssuedTokens;
      try {
        data = await retryWithBackoff(
          () => postRefreshToken(storedData.refreshToken),
          {
            shouldRetry: shouldRetryRefresh,
            waitUntilOnline: waitForOnlineWithinBound,
          }
        );
      } catch (err) {
        return await handleRefreshFailure(err);
      }

      const updatedAuthData: AuthData = {
        accessToken: data.access_token,
        // Kept deliberately: the fallback only fires when the response arrived without a
        // new refresh token, so the server did not rotate on this exchange and dropping
        // it would end a session the server considers live. The rotation case that
        // matters is the response that never arrived, which `rotationGuard` tracks.
        refreshToken: data.refresh_token || storedData.refreshToken,
        idToken: data.id_token,
        ...readIssuedClaims(data),
      };

      // The session may have ended, or a new one begun, while the request was out.
      // Saving now would put a dead session back on disk and in Redux.
      const current = await loadAuthDataFromSecureStore();
      if (current?.refreshToken !== diskRefreshToken) {
        unsaved = null;
        return null;
      }

      try {
        await saveAuthDataToSecureStore(updatedAuthData as SecureAuthData);
        unsaved = null;
        await clearInterruptedRefresh();
      } catch (err) {
        // The server has already rotated the stored refresh token away, so the new set
        // lives only in memory: it is handed to the caller and to Redux, and the next
        // refresh sends it rather than the dead token on disk. If the app is killed
        // before a save succeeds, that dead token's invalid_grant is a lost rotation,
        // not an ordinary expiry.
        console.error("Token refresh: issued tokens could not be stored", err);
        unsaved = { replaces: diskRefreshToken, authData: updatedAuthData };
        await markRefreshInterrupted();
      }

      authEmitter.emit(Event.AuthSession, {
        status: "authenticated",
        authData: updatedAuthData,
      });
      return updatedAuthData;
    } catch (err: unknown) {
      // Only reachable from reading the store around the request, which is not the
      // server's verdict on the session.
      console.error(
        "Token refresh error:",
        err instanceof Error ? err.message : err
      );
      authEmitter.emit(Event.AuthSession, { status: "degraded" });
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
};
