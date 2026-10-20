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

export type AuthErrorKind =
  | "network" // fetch rejected, no response
  | "timeout" // AbortController fired
  | "invalid_grant" // OAuth: refresh token is provably dead
  | "server" // HTTP 5xx, or 429
  | "client" // other 4xx, including a 400 that is NOT invalid_grant
  | "unknown"; // anything unclassifiable (malformed JSON, jwtDecode throw, ...)

export type OAuthErrorBody = { error?: string; error_description?: string };

export class AuthError extends Error {
  readonly kind: AuthErrorKind;
  readonly status?: number;
  readonly oauthError?: string;

  constructor(
    kind: AuthErrorKind,
    message: string,
    opts?: { status?: number; oauthError?: string; cause?: unknown }
  ) {
    super(message);
    this.name = "AuthError";
    this.kind = kind;
    this.status = opts?.status;
    this.oauthError = opts?.oauthError;
    if (opts && "cause" in opts) {
      // Assigned rather than passed to super(): ErrorOptions is not available
      // on every RN/Hermes runtime this app ships to.
      (this as { cause?: unknown }).cause = opts.cause;
    }
    // Required for `instanceof` to survive TypeScript's ES5 class downlevelling.
    Object.setPrototypeOf(this, AuthError.prototype);
  }
}

// The only OAuth code allowed to end a session: it is the one signal the server
// gives that the refresh token is provably dead. Anything else (another 400
// code, a 5xx, a dropped connection) is transient or ambiguous and must leave
// the session alone. The message-text matching below is telemetry wording only
// and can never reach this constant, so it can never log a user out.
const INVALID_GRANT = "invalid_grant";

// Fallback only: no runtime words a dead connection the same way and none
// expose a code. Picks a retry strategy, never ends a session.
const NETWORK_MESSAGE_PATTERN =
  /(network request failed|failed to fetch|network error)/i;

const isNamed = (error: unknown, name: string): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { name?: unknown }).name === name;

const classifyStatus = (
  status: number,
  body?: OAuthErrorBody | null
): AuthErrorKind => {
  if (status === 400 && body?.error === INVALID_GRANT) {
    return INVALID_GRANT;
  }
  if (status === 429 || status >= 500) {
    return "server";
  }
  return "client";
};

/**
 * Classify a thrown error, or a completed-but-failed response. A response that
 * came back wins over anything thrown while reading it: a JSON parse failure on
 * a 503 must not downgrade it to "unknown".
 */
export function classifyAuthError(input: {
  error?: unknown;
  status?: number;
  body?: OAuthErrorBody | null;
}): AuthErrorKind {
  const { error, status, body } = input;

  if (typeof status === "number" && status >= 400) {
    return classifyStatus(status, body);
  }

  if (error instanceof AuthError) {
    return error.kind;
  }
  // A DOMException in the browser, a plain Error in RN's polyfill: only the
  // name is common to both.
  if (isNamed(error, "AbortError")) {
    return "timeout";
  }
  if (error instanceof SyntaxError) {
    return "unknown";
  }
  if (error instanceof TypeError) {
    return "network";
  }
  if (error instanceof Error && NETWORK_MESSAGE_PATTERN.test(error.message)) {
    return "network";
  }
  return "unknown";
}

// Repeating a "client" or "unknown" cannot change the answer, and an
// "invalid_grant" token is already dead.
export function isRetryable(kind: AuthErrorKind): boolean {
  return kind === "network" || kind === "timeout" || kind === "server";
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => {
      clearTimeout(timer);
      resolve();
    }, ms);
  });

const defaultShouldRetry = (err: unknown): boolean =>
  err instanceof AuthError ? isRetryable(err.kind) : true;

/**
 * Run `fn(1)`, `fn(2)`, ... until it resolves or the attempts run out, sleeping
 * `baseDelayMs * factor ** (attempt - 1)` plus up to `jitterMs` between tries.
 * Rethrows the last error.
 *
 * With `waitUntilOnline`, each attempt first waits for it, so time spent offline costs no
 * attempts. If it rejects, that error is thrown as is and no further attempt is made.
 */
export function retryWithBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  options?: {
    attempts?: number; // default 3 (total attempts, not extra retries)
    baseDelayMs?: number; // default 500
    factor?: number; // default 2
    jitterMs?: number; // default 100
    shouldRetry?: (err: unknown, attempt: number) => boolean;
    sleep?: (ms: number) => Promise<void>; // injectable for tests
    random?: () => number; // injectable for tests
    waitUntilOnline?: () => Promise<void>;
  }
): Promise<T> {
  const {
    attempts = 3,
    baseDelayMs = 500,
    factor = 2,
    jitterMs = 100,
    shouldRetry = defaultShouldRetry,
    sleep = defaultSleep,
    random = Math.random,
    waitUntilOnline,
  } = options ?? {};

  const run = async (): Promise<T> => {
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      await waitUntilOnline?.();
      try {
        return await fn(attempt);
      } catch (error) {
        lastError = error;
        if (!shouldRetry(error, attempt)) {
          throw error;
        }
        if (attempt === attempts) {
          break;
        }
        await sleep(baseDelayMs * factor ** (attempt - 1) + random() * jitterMs);
      }
    }

    throw lastError;
  };

  return run();
}
