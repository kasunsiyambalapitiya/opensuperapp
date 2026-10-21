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

// The rule this whole suite exists to pin down: only a refresh token the
// server has provably rejected (400 invalid_grant) may end a session. A dead
// connection, a 5xx, a captive portal, a timeout - none of those are a verdict
// on the session, and none of them may log anyone out.
import type { AuthData, SessionSignal } from "@/types/auth.types";
import {
  forgetUnsavedTokens,
  refreshAccessToken,
} from "@/services/tokenRefresh";
import { Event } from "@/constants/enums/Event";
import { authEmitter, reachabilityEmitter } from "@/utils/eventEmitter";
import { Alert } from "react-native";

// The token endpoint is read when the module loads, so it is pinned here
// rather than being whatever EXPO_PUBLIC_TOKEN_URL happens to be in the shell
// running the tests.
jest.mock("@/constants/Constants", () => ({
  __esModule: true,
  ...jest.requireActual("@/constants/Constants"),
  TOKEN_URL: "https://auth.example.com/oauth2/token",
  CLIENT_ID: "test-client",
}));

jest.mock("react-native", () => ({
  Alert: { alert: jest.fn() },
  // constants/Constants.ts (imported transitively) reads Platform.OS.
  Platform: { OS: "ios" },
}));

// Every factory below forwards to its jest.fn() instead of returning it: the
// factories run while the module under test is being imported, which is before
// these consts are initialised, so the fn has to be looked up per call.
const mockLoadAuthDataFromSecureStore = jest.fn();
const mockSaveAuthDataToSecureStore = jest.fn();
jest.mock("@/utils/authTokenStore", () => ({
  loadAuthDataFromSecureStore: (...args: unknown[]) =>
    mockLoadAuthDataFromSecureStore(...args),
  saveAuthDataToSecureStore: (...args: unknown[]) =>
    mockSaveAuthDataToSecureStore(...args),
  clearAuthDataFromSecureStore: jest.fn(),
}));

const mockReadInterruptedRefresh = jest.fn();
const mockMarkRefreshInterrupted = jest.fn();
const mockClearInterruptedRefresh = jest.fn();
jest.mock("@/utils/rotationGuard", () => ({
  readInterruptedRefresh: (...args: unknown[]) =>
    mockReadInterruptedRefresh(...args),
  markRefreshInterrupted: (...args: unknown[]) =>
    mockMarkRefreshInterrupted(...args),
  clearInterruptedRefresh: (...args: unknown[]) =>
    mockClearInterruptedRefresh(...args),
}));

// The NetInfo mock never reports a state, so the real waitForOnline would wait forever.
// Online unless a test says otherwise.
const mockWaitForOnline = jest.fn();
jest.mock("@/utils/connectivity", () => ({
  waitForOnline: (...args: unknown[]) => mockWaitForOnline(...args),
}));

const mockJwtDecode = jest.fn();
jest.mock("jwt-decode", () => ({
  jwtDecode: (...args: unknown[]) => mockJwtDecode(...args),
}));

// Pulled in by the module under test but never exercised here: stubbed so the
// import graph stays cheap and free of native modules.
jest.mock("react-native-app-auth", () => ({ logout: jest.fn() }));
jest.mock("@/utils/exchangedTokenStore", () => ({
  clearAllExchangedTokens: jest.fn(),
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
// Mocked to avoid pulling in @reduxjs/toolkit's ESM `immer` dependency, which
// this project's Jest transform isn't configured for. Both are plain action
// creators; these stubs mirror their shape.
jest.mock("@/context/slices/appSlice", () => ({
  updateExchangedToken: (payload: unknown) => ({
    type: "app/updateExchangedToken",
    payload,
  }),
  updateExchangedIdToken: (payload: unknown) => ({
    type: "app/updateExchangedIdToken",
    payload,
  }),
}));

// refreshAccessToken sleeps 500ms then 1000ms between its three attempts, and
// the suite runs those for real rather than faking timers: postRefreshToken
// also arms a 15s AbortController timeout on every attempt, and driving both
// clocks by hand buys nothing over just waiting ~1.6s for the failing cases.
jest.setTimeout(20000);

const TOKEN_URL = "https://auth.example.com/oauth2/token";
const OLD_REFRESH_TOKEN = "old-refresh-token";
const EXP_SECONDS = 1893456000;

const storedAuth = {
  accessToken: "old-access-token",
  refreshToken: OLD_REFRESH_TOKEN,
  idToken: "old-id-token",
  email: "user@example.com",
  userId: "user-1",
  expiresAt: 0,
};

const ISSUED_TOKENS = {
  access_token: "new-access-token",
  id_token: "new-id-token",
  refresh_token: "new-refresh-token",
};

type FakeResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
};

const response = (status: number, body: unknown): FakeResponse => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: `status ${status}`,
  json: async () => body,
});

/** A body no JSON parser can make sense of: a captive portal's login page. */
const unparsableResponse = (status: number): FakeResponse => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: `status ${status}`,
  json: async () => {
    throw new SyntaxError("Unexpected token < in JSON at position 0");
  },
});

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const alertMock = Alert.alert as jest.Mock;

// What the refresh told the rest of the app about the session. The one listener
// in app/_layout turns "expired" into endSession, so an "expired" here is a logout.
let signals: SessionSignal[];
const expiries = () => signals.filter((s) => s.status === "expired").length;

beforeEach(() => {
  forgetUnsavedTokens();
  mockFetch.mockReset();
  alertMock.mockClear();

  mockLoadAuthDataFromSecureStore.mockReset().mockResolvedValue(storedAuth);
  mockSaveAuthDataToSecureStore.mockReset().mockResolvedValue(undefined);
  mockReadInterruptedRefresh.mockReset().mockResolvedValue(null);
  mockMarkRefreshInterrupted.mockReset().mockResolvedValue(undefined);
  mockClearInterruptedRefresh.mockReset().mockResolvedValue(undefined);
  mockWaitForOnline.mockReset().mockResolvedValue(undefined);
  mockJwtDecode.mockReset().mockImplementation(() => ({
    email: "user@example.com",
    userid: "user-1",
    exp: EXP_SECONDS,
  }));

  signals = [];
  authEmitter.on(Event.AuthSession, (signal) => signals.push(signal));
  // The failure paths are expected to log; the assertions below are what
  // decides whether they behaved, not the console.
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  authEmitter.removeAllListeners();
});

describe("refreshAccessToken", () => {
  it("returns and persists the new token set when the server answers 200", async () => {
    mockFetch.mockResolvedValue(response(200, ISSUED_TOKENS));

    const result = await refreshAccessToken();

    const expected: AuthData = {
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      idToken: "new-id-token",
      email: "user@example.com",
      userId: "user-1",
      expiresAt: EXP_SECONDS * 1000,
    };
    expect(result).toEqual(expected);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(TOKEN_URL);
    expect(init.method).toBe("POST");
    expect(init.body).toContain("grant_type=refresh_token");
    expect(init.body).toContain(`refresh_token=${OLD_REFRESH_TOKEN}`);

    expect(mockSaveAuthDataToSecureStore).toHaveBeenCalledTimes(1);
    expect(mockSaveAuthDataToSecureStore).toHaveBeenCalledWith(expected);
    expect(mockClearInterruptedRefresh).toHaveBeenCalled();
    expect(expiries()).toBe(0);
  });

  it("carries the stored refresh token forward when the server does not rotate it", async () => {
    mockFetch.mockResolvedValue(
      response(200, {
        access_token: "new-access-token",
        id_token: "new-id-token",
      })
    );

    const result = await refreshAccessToken();

    expect(result?.accessToken).toBe("new-access-token");
    expect(result?.refreshToken).toBe(OLD_REFRESH_TOKEN);
    expect(mockSaveAuthDataToSecureStore).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: OLD_REFRESH_TOKEN })
    );
    expect(expiries()).toBe(0);
  });

  it("logs out once, without retrying, on a 400 invalid_grant", async () => {
    mockFetch.mockResolvedValue(response(400, { error: "invalid_grant" }));

    const result = await refreshAccessToken();

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(expiries()).toBe(1);
  });

  it("reports an ordinary expiry as one, when no refresh was ever interrupted", async () => {
    mockReadInterruptedRefresh.mockResolvedValue(null);
    mockFetch.mockResolvedValue(response(400, { error: "invalid_grant" }));

    await refreshAccessToken();

    expect(signals).toContainEqual({ status: "expired", rotationLost: false });
  });

  it("reports a lost rotation differently from an ordinary expiry", async () => {
    mockReadInterruptedRefresh.mockResolvedValue({ interruptedAt: 1 });
    mockFetch.mockResolvedValue(response(400, { error: "invalid_grant" }));

    await refreshAccessToken();

    expect(signals).toContainEqual({ status: "expired", rotationLost: true });
    expect(mockClearInterruptedRefresh).toHaveBeenCalled();
  });

  // The sign-in sheet tells the user; a dialog from here as well asks them twice.
  it("leaves telling the user to the app, with no dialog of its own", async () => {
    mockReadInterruptedRefresh.mockResolvedValue({ interruptedAt: 1 });
    mockFetch.mockResolvedValue(response(400, { error: "invalid_grant" }));

    await refreshAccessToken();
    mockReadInterruptedRefresh.mockResolvedValue(null);
    await refreshAccessToken();

    expect(alertMock).not.toHaveBeenCalled();
  });

  it("never logs out when the network is down, however many attempts fail", async () => {
    mockFetch.mockRejectedValue(new TypeError("Network request failed"));

    const result = await refreshAccessToken();

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockMarkRefreshInterrupted).toHaveBeenCalled();
    expect(expiries()).toBe(0);
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("recovers when a transient failure is followed by a good response", async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce(response(200, ISSUED_TOKENS));

    const result = await refreshAccessToken();

    expect(result?.accessToken).toBe("new-access-token");
    expect(result?.refreshToken).toBe("new-refresh-token");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(expiries()).toBe(0);
  });

  it("retries a 503 and keeps the session when the server stays down", async () => {
    mockFetch.mockResolvedValue(response(503, { error: "unavailable" }));

    const result = await refreshAccessToken();

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(expiries()).toBe(0);
  });

  it("retries a 400 that is not invalid_grant and keeps the session", async () => {
    mockFetch.mockResolvedValue(response(400, { error: "invalid_request" }));

    const result = await refreshAccessToken();

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(expiries()).toBe(0);
  });

  it("does not retry a 401 from the token endpoint, and does not log out", async () => {
    mockFetch.mockResolvedValue(response(401, { error: "unauthorized" }));

    const result = await refreshAccessToken();

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(expiries()).toBe(0);
  });

  it("treats a captive portal's unparsable 200 as the server's fault, not the session's", async () => {
    mockFetch.mockResolvedValue(unparsableResponse(200));

    const result = await refreshAccessToken();

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(expiries()).toBe(0);
  });

  it("retries a 200 that came back without an id_token, and keeps the session", async () => {
    mockFetch.mockResolvedValue(
      response(200, { access_token: "new-access-token" })
    );

    const result = await refreshAccessToken();

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockSaveAuthDataToSecureStore).not.toHaveBeenCalled();
    expect(expiries()).toBe(0);
  });

  it("gives up without a request when there is no stored refresh token", async () => {
    mockLoadAuthDataFromSecureStore.mockResolvedValue(null);

    const result = await refreshAccessToken();

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(expiries()).toBe(0);
  });

  it("shares a single request between callers that overlap", async () => {
    mockFetch.mockResolvedValue(response(200, ISSUED_TOKENS));

    const first = refreshAccessToken();
    const second = refreshAccessToken();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(firstResult).toBe(secondResult);
    expect(firstResult?.accessToken).toBe("new-access-token");
    expect(mockSaveAuthDataToSecureStore).toHaveBeenCalledTimes(1);
  });

  it("keeps a token set the server issued even when its claims will not decode", async () => {
    // The 200 means the server may already have rotated the old refresh token
    // away. Dropping the replacement over an unreadable JWT is what strands the
    // session on a token the server has retired.
    mockFetch.mockResolvedValue(response(200, ISSUED_TOKENS));
    mockJwtDecode.mockImplementation(() => {
      throw new Error("Invalid token specified");
    });

    const result = await refreshAccessToken();

    expect(result?.refreshToken).toBe("new-refresh-token");
    expect(mockSaveAuthDataToSecureStore).toHaveBeenCalledTimes(1);
    expect(mockSaveAuthDataToSecureStore).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        // Reads as expired, so the next call refreshes again with the token we
        // did manage to keep.
        expiresAt: 0,
      })
    );
    expect(expiries()).toBe(0);
  });
});

// A refresh can take seconds; the user may sign out, or the session expire, before it
// lands. Writing its tokens back then would bring a session nobody owns back to life.
describe("a refresh that lands after the session changed", () => {
  it("neither stores nor reports its tokens once the session has ended", async () => {
    mockLoadAuthDataFromSecureStore
      .mockResolvedValueOnce(storedAuth)
      .mockResolvedValueOnce(null);
    mockFetch.mockResolvedValue(response(200, ISSUED_TOKENS));

    const result = await refreshAccessToken();

    expect(result).toBeNull();
    expect(mockSaveAuthDataToSecureStore).not.toHaveBeenCalled();
    expect(signals.some((s) => s.status === "authenticated")).toBe(false);
  });

  it("does not overwrite the tokens of a newer sign-in", async () => {
    mockLoadAuthDataFromSecureStore
      .mockResolvedValueOnce(storedAuth)
      .mockResolvedValueOnce({ ...storedAuth, refreshToken: "signed-in-again" });
    mockFetch.mockResolvedValue(response(200, ISSUED_TOKENS));

    const result = await refreshAccessToken();

    expect(result).toBeNull();
    expect(mockSaveAuthDataToSecureStore).not.toHaveBeenCalled();
    expect(signals.some((s) => s.status === "authenticated")).toBe(false);
  });
});

// The server rotates the refresh token on every exchange, so once a new set could not be
// stored the token on disk is dead. Sending it would end a session that is still live.
describe("a refresh whose tokens could not be stored", () => {
  const sentRefreshToken = (call: number) =>
    new URLSearchParams(mockFetch.mock.calls[call][1].body).get(
      "refresh_token"
    );
  const NEXT_TOKENS = { ...ISSUED_TOKENS, refresh_token: "next-refresh-token" };

  beforeEach(async () => {
    mockFetch.mockResolvedValueOnce(response(200, ISSUED_TOKENS));
    mockSaveAuthDataToSecureStore.mockRejectedValueOnce(new Error("keychain"));
    await refreshAccessToken();
  });

  it("sends the issued refresh token next time, not the dead one on disk", async () => {
    mockFetch.mockResolvedValueOnce(response(200, NEXT_TOKENS));

    const result = await refreshAccessToken();

    expect(sentRefreshToken(1)).toBe("new-refresh-token");
    expect(result?.refreshToken).toBe("next-refresh-token");
    expect(mockSaveAuthDataToSecureStore).toHaveBeenLastCalledWith(
      expect.objectContaining({ refreshToken: "next-refresh-token" })
    );
  });

  it("goes back to the token on disk once a later set is stored", async () => {
    mockFetch.mockResolvedValue(response(200, NEXT_TOKENS));
    await refreshAccessToken();
    mockLoadAuthDataFromSecureStore.mockResolvedValue({
      ...storedAuth,
      refreshToken: "next-refresh-token",
    });

    await refreshAccessToken();

    expect(sentRefreshToken(2)).toBe("next-refresh-token");
  });

  it("drops it once a new sign-in has put another token on disk", async () => {
    mockLoadAuthDataFromSecureStore.mockResolvedValue({
      ...storedAuth,
      refreshToken: "signed-in-again",
    });
    mockFetch.mockResolvedValueOnce(response(200, NEXT_TOKENS));

    await refreshAccessToken();

    expect(sentRefreshToken(1)).toBe("signed-in-again");
  });

  it("drops it when the session ends", async () => {
    forgetUnsavedTokens();
    mockFetch.mockResolvedValueOnce(response(200, NEXT_TOKENS));

    await refreshAccessToken();

    expect(sentRefreshToken(1)).toBe(OLD_REFRESH_TOKEN);
  });
});

describe("while the device is offline", () => {
  // Mirrors the bound in tokenRefresh.ts. Every screen that wants a token waits behind a
  // refresh in flight, so it cannot wait for a reconnect indefinitely.
  const OFFLINE_WAIT_TIMEOUT_MS = 30000;

  it("holds the request until the device is back online, then sends it", async () => {
    let reconnect: () => void = () => {};
    mockWaitForOnline.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        reconnect = resolve;
      })
    );
    mockFetch.mockResolvedValue(response(200, ISSUED_TOKENS));

    const refreshing = refreshAccessToken();
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockFetch).not.toHaveBeenCalled();

    reconnect();

    await expect(refreshing).resolves.toMatchObject({
      accessToken: "new-access-token",
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not spend its attempts while offline", async () => {
    // Every attempt drops; the device is offline between each. Three attempts
    // still means three requests, not three failed waits.
    mockFetch.mockRejectedValue(new TypeError("Network request failed"));

    await refreshAccessToken();

    expect(mockWaitForOnline).toHaveBeenCalledTimes(3);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(expiries()).toBe(0);
  });

  it("stops waiting after a bound, keeps the session, and sends nothing", async () => {
    mockWaitForOnline.mockImplementation(
      (signal: AbortSignal) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => {
            const aborted = new Error("Stopped waiting for a connection");
            aborted.name = "AbortError";
            reject(aborted);
          });
        })
    );
    const seen: boolean[] = [];
    const off = reachabilityEmitter.on(Event.AuthReachability, (v) =>
      seen.push(v as boolean)
    );

    jest.useFakeTimers();
    try {
      const refreshing = refreshAccessToken();
      await jest.advanceTimersByTimeAsync(OFFLINE_WAIT_TIMEOUT_MS - 1);
      expect(mockWaitForOnline.mock.calls[0][0].aborted).toBe(false);

      await jest.advanceTimersByTimeAsync(1);
      await expect(refreshing).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
      off();
    }

    expect(mockFetch).not.toHaveBeenCalled();
    // Nothing was sent, so nothing can have been rotated away.
    expect(mockMarkRefreshInterrupted).not.toHaveBeenCalled();
    expect(expiries()).toBe(0);
    expect(alertMock).not.toHaveBeenCalled();
    expect(seen).toEqual([false]);
  });

  it("lets the next caller start a fresh refresh after giving up", async () => {
    mockWaitForOnline.mockRejectedValueOnce(
      Object.assign(new Error("Stopped waiting"), { name: "AbortError" })
    );
    await expect(refreshAccessToken()).resolves.toBeNull();

    mockFetch.mockResolvedValue(response(200, ISSUED_TOKENS));
    await expect(refreshAccessToken()).resolves.toMatchObject({
      accessToken: "new-access-token",
    });
  });
});

describe("what the user is told while the session is fine", () => {
  const collectReachability = () => {
    const seen: boolean[] = [];
    const off = reachabilityEmitter.on(Event.AuthReachability, (v) =>
      seen.push(v as boolean)
    );
    return { seen, off };
  };

  it("reports the backend unreachable once the retries are spent", async () => {
    const { seen, off } = collectReachability();
    mockFetch.mockRejectedValue(new TypeError("Network request failed"));

    await refreshAccessToken();
    off();

    // Once, not once per attempt: a single blip must not flicker the banner.
    expect(seen).toEqual([false]);
    expect(expiries()).toBe(0);
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("reports it reachable again as soon as any response arrives", async () => {
    const { seen, off } = collectReachability();
    mockFetch.mockResolvedValue(response(200, ISSUED_TOKENS));

    await refreshAccessToken();
    off();

    expect(seen).toEqual([true]);
  });

  it("counts a refused response as reachable, because it is", async () => {
    const { seen, off } = collectReachability();
    mockFetch.mockResolvedValue(response(400, { error: "invalid_grant" }));

    await refreshAccessToken();
    off();

    expect(seen).toEqual([true]);
  });
});

describe("what the refresh reports about the session", () => {
  it("reports refreshing, then authenticated with the new tokens, on success", async () => {
    mockFetch.mockResolvedValue(response(200, ISSUED_TOKENS));

    const result = await refreshAccessToken();

    // The tokens go out with the signal so Redux gets them too, not just
    // SecureStore.
    expect(signals).toEqual([
      { status: "refreshing" },
      { status: "authenticated", authData: result },
    ]);
    expect(result?.accessToken).toBe("new-access-token");
  });

  it("reports degraded, and never expired, once network retries are spent", async () => {
    mockFetch.mockRejectedValue(new TypeError("Network request failed"));

    await refreshAccessToken();

    expect(signals).toEqual([{ status: "refreshing" }, { status: "degraded" }]);
  });

  it("reports degraded when the server stays down", async () => {
    mockFetch.mockResolvedValue(response(503, { error: "unavailable" }));

    await refreshAccessToken();

    expect(signals).toEqual([{ status: "refreshing" }, { status: "degraded" }]);
  });

  it("reports expired on invalid_grant", async () => {
    mockFetch.mockResolvedValue(response(400, { error: "invalid_grant" }));

    await refreshAccessToken();

    expect(signals).toEqual([
      { status: "refreshing" },
      { status: "expired", rotationLost: false },
    ]);
  });

  it("reports expired once however many callers were waiting on the refresh", async () => {
    mockFetch.mockResolvedValue(response(400, { error: "invalid_grant" }));

    const results = await Promise.all(
      Array.from({ length: 5 }, () => refreshAccessToken())
    );

    expect(results).toEqual([null, null, null, null, null]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(expiries()).toBe(1);
  });

  it("still uses the new tokens when they cannot be stored, and remembers the rotation", async () => {
    // The server has rotated the old refresh token away; the new one now lives only in
    // memory. Use it while the app runs, and record that the one on disk may be dead so
    // a later invalid_grant is explained as a lost rotation rather than a plain expiry.
    mockFetch.mockResolvedValue(response(200, ISSUED_TOKENS));
    mockSaveAuthDataToSecureStore.mockRejectedValue(new Error("keychain"));

    const result = await refreshAccessToken();

    expect(result?.accessToken).toBe("new-access-token");
    expect(result?.refreshToken).toBe("new-refresh-token");
    expect(signals).toEqual([
      { status: "refreshing" },
      { status: "authenticated", authData: result },
    ]);
    expect(mockMarkRefreshInterrupted).toHaveBeenCalled();
    expect(mockClearInterruptedRefresh).not.toHaveBeenCalled();
  });

  it("reports nothing when there is no session to refresh", async () => {
    mockLoadAuthDataFromSecureStore.mockResolvedValue(null);

    await refreshAccessToken();

    expect(signals).toEqual([]);
  });
});
