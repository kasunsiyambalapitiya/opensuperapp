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

// Shared by authService and tokenRefresh, which call each other; keeping the shapes here
// is what stops that being an import cycle.
export interface DecodedIdToken {
  email?: string;
  userid?: string;
}

export interface AuthData {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  email?: string;
  userId?: string;
  expiresAt: number;
}

/**
 * Where the session stands, as opposed to which tokens Redux happens to hold.
 *
 * - restoring: cold start, stored tokens not read yet.
 * - authenticated: tokens are usable.
 * - refreshing: a token refresh is in flight.
 * - degraded: a refresh ran out of attempts without a verdict (no network, a 5xx).
 *   Nothing is destroyed and the next good refresh makes it authenticated again.
 * - expired: the server rejected the refresh token; the user has to sign in again.
 * - signedOut: never signed in, or the user signed out.
 */
export type SessionStatus =
  | "restoring"
  | "authenticated"
  | "refreshing"
  | "degraded"
  | "expired"
  | "signedOut";

/** What a token refresh reports about the session, on `authEmitter`. */
export type SessionSignal =
  | { status: "refreshing" }
  | { status: "authenticated"; authData: AuthData }
  | { status: "degraded" }
  | { status: "expired" };
