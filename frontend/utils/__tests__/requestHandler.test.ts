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
import { reachabilityEmitter } from "@/utils/eventEmitter";
import { apiRequest } from "@/utils/requestHandler";

const mockAxios = jest.fn();
jest.mock("axios", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockAxios(...args),
}));

const mockRefreshAccessToken = jest.fn();
jest.mock("@/services/tokenRefresh", () => ({
  refreshAccessToken: () => mockRefreshAccessToken(),
}));

const mockStartedBeforeReconnect = jest.fn();
jest.mock("@/utils/connectivity", () => ({
  startedBeforeReconnect: (startedAt: number) =>
    mockStartedBeforeReconnect(startedAt),
}));

const mockLoadAuthData = jest.fn();
jest.mock("@/utils/authTokenStore", () => ({
  loadAuthDataFromSecureStore: () => mockLoadAuthData(),
}));

const jwt = (claims: { iat: number; exp: number }) =>
  ["none", JSON.stringify(claims), "sig"]
    .map((part) => Buffer.from(part).toString("base64url"))
    .join(".");

const NOW_S = 1_750_000_000;
const tokenExpiringIn = (seconds: number) =>
  jwt({ iat: NOW_S + seconds - 3600, exp: NOW_S + seconds });

const sentToken = () =>
  mockAxios.mock.calls[0][0].headers.Authorization.replace("Bearer ", "");

beforeEach(() => {
  jest.useFakeTimers({ now: NOW_S * 1000 });
  mockAxios.mockReset().mockResolvedValue({ data: "ok" });
  mockRefreshAccessToken
    .mockReset()
    .mockResolvedValue({ accessToken: "refreshed-token" });
  mockLoadAuthData.mockReset();
  mockStartedBeforeReconnect.mockReset().mockReturnValue(false);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("apiRequest", () => {
  // The proactive refresh owns the 80% point. A refresh that fails there must not take
  // down requests whose token still works, so requests only refresh at expiry.
  it("sends a token past its refresh point without refreshing it", async () => {
    const token = tokenExpiringIn(300);
    mockLoadAuthData.mockResolvedValue({ accessToken: token });

    await apiRequest({ url: "https://api.example.com/apps" });

    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    expect(sentToken()).toBe(token);
  });

  it("refreshes a token about to expire on the way to the server", async () => {
    mockLoadAuthData.mockResolvedValue({ accessToken: tokenExpiringIn(10) });

    await apiRequest({ url: "https://api.example.com/apps" });

    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
    expect(sentToken()).toBe("refreshed-token");
  });

  it("refreshes an expired token", async () => {
    mockLoadAuthData.mockResolvedValue({ accessToken: tokenExpiringIn(-10) });

    await apiRequest({ url: "https://api.example.com/apps" });

    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
    expect(sentToken()).toBe("refreshed-token");
  });
});

// A half-dead connection can hold a socket open for minutes on mobile, and a screen
// waiting on it shows a spinner the whole time.
describe("apiRequest timeouts", () => {
  const API_REQUEST_TIMEOUT_MS = 30000;

  /** What axios rejects with when its timeout fires: no response came back. */
  const timedOut = () =>
    Object.assign(
      new Error(`timeout of ${API_REQUEST_TIMEOUT_MS}ms exceeded`),
      { isAxiosError: true, code: "ECONNABORTED" }
    );

  beforeEach(() => {
    mockLoadAuthData.mockResolvedValue({ accessToken: tokenExpiringIn(3600) });
  });

  it("gives up on a request that does not answer within the bound", async () => {
    await apiRequest({ url: "https://api.example.com/apps" });

    expect(mockAxios.mock.calls[0][0].timeout).toBe(API_REQUEST_TIMEOUT_MS);
  });

  it("keeps a caller's own timeout", async () => {
    await apiRequest({ url: "https://api.example.com/apps", timeout: 5000 });

    expect(mockAxios.mock.calls[0][0].timeout).toBe(5000);
  });

  it("treats a timeout as the backend being out of reach, never as the session's end", async () => {
    mockAxios.mockRejectedValue(timedOut());
    const seen: boolean[] = [];
    const off = reachabilityEmitter.on(Event.AuthReachability, (v) =>
      seen.push(v as boolean)
    );

    await expect(
      apiRequest({ url: "https://api.example.com/apps" })
    ).rejects.toMatchObject({ code: "ECONNABORTED" });
    off();

    expect(seen).toEqual([false]);
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });

  // Sent into a dead network, it can fail after the network is back. The banner would
  // then come back over a working connection and stay until the next request went out.
  it("does not report a failure from before the latest reconnect", async () => {
    mockAxios.mockRejectedValue(timedOut());
    mockStartedBeforeReconnect.mockReturnValue(true);
    const seen: boolean[] = [];
    const off = reachabilityEmitter.on(Event.AuthReachability, (v) =>
      seen.push(v as boolean)
    );

    await expect(
      apiRequest({ url: "https://api.example.com/apps" })
    ).rejects.toMatchObject({ code: "ECONNABORTED" });
    off();

    expect(seen).toEqual([]);
    expect(mockStartedBeforeReconnect).toHaveBeenCalledWith(NOW_S * 1000);
  });
});
