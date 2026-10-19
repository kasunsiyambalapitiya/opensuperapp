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

// When a token stops being usable, and when it is worth renewing ahead of that.
//
// A token that cannot be read counts as expired and due: the only safe thing to do with
// a token whose lifetime is unknown is to get one whose lifetime is known.
import { jwtDecode } from "jwt-decode";

const MILLISECONDS_IN_A_SECOND = 1000;
// Late enough that a renewal is not wasted on a token with most of its life left, early
// enough that a renewal which has to wait out a dead connection still lands before the
// token stops working. For a one-hour token that leaves 12 minutes.
const REFRESH_AT_LIFETIME_FRACTION = 0.8;
/** Device clocks drift from the server's; a token is treated as this much older. */
export const CLOCK_SKEW_MS = 30 * MILLISECONDS_IN_A_SECOND;

type Lifetime = { issuedAt?: number; expiresAt: number };

const readLifetime = (token: string | null): Lifetime | null => {
  if (!token) return null;
  try {
    const { iat, exp } = jwtDecode<{ iat?: number; exp?: number }>(token);
    if (typeof exp !== "number") return null;
    const expiresAt = exp * MILLISECONDS_IN_A_SECOND;
    const issuedAt =
      typeof iat === "number" ? iat * MILLISECONDS_IN_A_SECOND : undefined;
    return {
      expiresAt,
      issuedAt:
        issuedAt !== undefined && issuedAt < expiresAt ? issuedAt : undefined,
    };
  } catch {
    return null;
  }
};

/**
 * When `token` should be renewed, in epoch milliseconds: 80% of the way from `iat` to
 * `exp`, less the skew allowance. Without a usable `iat` the lifetime is unknown, so it
 * falls back to the expiry rather than guessing one: a guessed lifetime longer than the
 * real one would have every new token renewed the moment it arrives. 0 for a token that
 * cannot be read.
 */
export const refreshDueAt = (token: string | null): number => {
  const lifetime = readLifetime(token);
  if (!lifetime) return 0;
  const { issuedAt, expiresAt } = lifetime;
  const dueAt =
    issuedAt === undefined
      ? expiresAt
      : issuedAt + (expiresAt - issuedAt) * REFRESH_AT_LIFETIME_FRACTION;
  return dueAt - CLOCK_SKEW_MS;
};

/** Whether `token` is far enough through its lifetime to renew ahead of its expiry. */
export const shouldRefreshToken = (
  token: string | null,
  now: number = Date.now()
): boolean => now >= refreshDueAt(token);

/**
 * Whether `token` can no longer be used, allowing for clock skew: a token with seconds
 * left would expire on the way to the server.
 */
export const isTokenExpired = (
  token: string,
  now: number = Date.now()
): boolean => {
  const lifetime = readLifetime(token);
  return !lifetime || now >= lifetime.expiresAt - CLOCK_SKEW_MS;
};
