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
