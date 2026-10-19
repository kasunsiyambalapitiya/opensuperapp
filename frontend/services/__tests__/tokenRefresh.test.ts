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
import type { AuthData } from "@/types/auth.types";
import { refreshAccessToken } from "@/services/tokenRefresh";
import { Event } from "@/constants/enums/Event";
import { reachabilityEmitter } from "@/utils/eventEmitter";
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

/**
 * authService rate-limits the session alert to one per cooldown window, so a
 * test that expects a second alert has to wait the window out. `Date.now` is
 * spied rather than slept on, and the clock jumps between tests so one test's
 * alert cannot suppress the next one's.
 */
let mockNow = 1700000000000;
const ALERT_COOLDOWN_GAP_MS = 60000;
const advancePastAlertCooldown = () => {
  mockNow += ALERT_COOLDOWN_GAP_MS;
  alertMock.mockClear();
};

let onLogout: jest.Mock;

beforeEach(() => {
  mockFetch.mockReset();
  alertMock.mockClear();
  advancePastAlertCooldown();
  jest.spyOn(Date, "now").mockImplementation(() => mockNow);

  mockLoadAuthDataFromSecureStore.mockReset().mockResolvedValue(storedAuth);
  mockSaveAuthDataToSecureStore.mockReset().mockResolvedValue(undefined);
  mockReadInterruptedRefresh.mockReset().mockResolvedValue(null);
  mockMarkRefreshInterrupted.mockReset().mockResolvedValue(undefined);
  mockClearInterruptedRefresh.mockReset().mockResolvedValue(undefined);
  mockJwtDecode.mockReset().mockImplementation(() => ({
    email: "user@example.com",
    userid: "user-1",
    exp: EXP_SECONDS,
  }));

  onLogout = jest.fn().mockResolvedValue(undefined);
  // The failure paths are expected to log; the assertions below are what
  // decides whether they behaved, not the console.
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("refreshAccessToken", () => {
  it("returns and persists the new token set when the server answers 200", async () => {
    mockFetch.mockResolvedValue(response(200, ISSUED_TOKENS));

    const result = await refreshAccessToken(onLogout);

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
    expect(onLogout).not.toHaveBeenCalled();
  });

  it("carries the stored refresh token forward when the server does not rotate it", async () => {
    mockFetch.mockResolvedValue(
      response(200, {
        access_token: "new-access-token",
        id_token: "new-id-token",
      })
    );

    const result = await refreshAccessToken(onLogout);

    expect(result?.accessToken).toBe("new-access-token");
    expect(result?.refreshToken).toBe(OLD_REFRESH_TOKEN);
    expect(mockSaveAuthDataToSecureStore).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: OLD_REFRESH_TOKEN })
    );
    expect(onLogout).not.toHaveBeenCalled();
  });

  it("logs out once, without retrying, on a 400 invalid_grant", async () => {
    mockFetch.mockResolvedValue(response(400, { error: "invalid_grant" }));

    const result = await refreshAccessToken(onLogout);

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("tells an ordinary expiry as an expiry when no refresh was ever interrupted", async () => {
    mockReadInterruptedRefresh.mockResolvedValue(null);
    mockFetch.mockResolvedValue(response(400, { error: "invalid_grant" }));

    await refreshAccessToken(onLogout);

    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock.mock.calls[0][0]).toBe("Session Expired");
    expect(alertMock.mock.calls[0][0]).not.toBe("Signed Out");
    expect(alertMock.mock.calls[0][1]).not.toMatch(/connection/i);
  });

  it("tells a lost rotation differently from an ordinary expiry", async () => {
    mockReadInterruptedRefresh.mockResolvedValue({ interruptedAt: 1 });
    mockFetch.mockResolvedValue(response(400, { error: "invalid_grant" }));

    await refreshAccessToken(onLogout);

    expect(alertMock).toHaveBeenCalledTimes(1);
    const [lostTitle, lostMessage] = alertMock.mock.calls[0];
    expect(lostTitle).toBe("Signed Out");
    expect(lostMessage).toMatch(/lost your sign-in/i);
    expect(lostMessage).toMatch(/connection was down/i);

    // Same failure, no interruption marker: the copy has to differ, or the
    // marker is being read and thrown away.
    advancePastAlertCooldown();
    mockReadInterruptedRefresh.mockResolvedValue(null);
    const expiredLogout = jest.fn().mockResolvedValue(undefined);
    await refreshAccessToken(expiredLogout);

    const [expiredTitle, expiredMessage] = alertMock.mock.calls[0];
    expect(expiredTitle).not.toBe(lostTitle);
    expect(expiredMessage).not.toBe(lostMessage);
  });

  it("never logs out when the network is down, however many attempts fail", async () => {
    mockFetch.mockRejectedValue(new TypeError("Network request failed"));

    const result = await refreshAccessToken(onLogout);

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockMarkRefreshInterrupted).toHaveBeenCalled();
    expect(onLogout).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("recovers when a transient failure is followed by a good response", async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce(response(200, ISSUED_TOKENS));

    const result = await refreshAccessToken(onLogout);

    expect(result?.accessToken).toBe("new-access-token");
    expect(result?.refreshToken).toBe("new-refresh-token");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(onLogout).not.toHaveBeenCalled();
  });

  it("retries a 503 and keeps the session when the server stays down", async () => {
    mockFetch.mockResolvedValue(response(503, { error: "unavailable" }));

    const result = await refreshAccessToken(onLogout);

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(onLogout).not.toHaveBeenCalled();
  });

  it("retries a 400 that is not invalid_grant and keeps the session", async () => {
    mockFetch.mockResolvedValue(response(400, { error: "invalid_request" }));

    const result = await refreshAccessToken(onLogout);

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(onLogout).not.toHaveBeenCalled();
  });

  it("does not retry a 401 from the token endpoint, and does not log out", async () => {
    mockFetch.mockResolvedValue(response(401, { error: "unauthorized" }));

    const result = await refreshAccessToken(onLogout);

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(onLogout).not.toHaveBeenCalled();
  });

  it("treats a captive portal's unparsable 200 as the server's fault, not the session's", async () => {
    mockFetch.mockResolvedValue(unparsableResponse(200));

    const result = await refreshAccessToken(onLogout);

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(onLogout).not.toHaveBeenCalled();
  });

  it("retries a 200 that came back without an id_token, and keeps the session", async () => {
    mockFetch.mockResolvedValue(
      response(200, { access_token: "new-access-token" })
    );

    const result = await refreshAccessToken(onLogout);

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockSaveAuthDataToSecureStore).not.toHaveBeenCalled();
    expect(onLogout).not.toHaveBeenCalled();
  });

  it("gives up without a request when there is no stored refresh token", async () => {
    mockLoadAuthDataFromSecureStore.mockResolvedValue(null);

    const result = await refreshAccessToken(onLogout);

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(onLogout).not.toHaveBeenCalled();
  });

  it("shares a single request between callers that overlap", async () => {
    mockFetch.mockResolvedValue(response(200, ISSUED_TOKENS));

    const first = refreshAccessToken(onLogout);
    const second = refreshAccessToken(onLogout);
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

    const result = await refreshAccessToken(onLogout);

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
    expect(onLogout).not.toHaveBeenCalled();
  });

  it("does not stack session alerts while the cooldown is open", async () => {
    mockFetch.mockResolvedValue(response(400, { error: "invalid_grant" }));

    await refreshAccessToken(onLogout);
    await refreshAccessToken(jest.fn().mockResolvedValue(undefined));

    expect(alertMock).toHaveBeenCalledTimes(1);

    // And the suppression is a cooldown, not a latch that never reopens.
    advancePastAlertCooldown();
    await refreshAccessToken(jest.fn().mockResolvedValue(undefined));
    expect(alertMock).toHaveBeenCalledTimes(1);
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

    await refreshAccessToken(onLogout);
    off();

    // Once, not once per attempt: a single blip must not flicker the banner.
    expect(seen).toEqual([false]);
    expect(onLogout).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("reports it reachable again as soon as any response arrives", async () => {
    const { seen, off } = collectReachability();
    mockFetch.mockResolvedValue(response(200, ISSUED_TOKENS));

    await refreshAccessToken(onLogout);
    off();

    expect(seen).toEqual([true]);
  });

  it("counts a refused response as reachable, because it is", async () => {
    const { seen, off } = collectReachability();
    mockFetch.mockResolvedValue(response(400, { error: "invalid_grant" }));

    await refreshAccessToken(onLogout);
    off();

    expect(seen).toEqual([true]);
  });
});
