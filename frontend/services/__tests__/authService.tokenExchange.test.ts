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
import { tokenExchange } from "@/services/authService";
import { reachabilityEmitter } from "@/utils/eventEmitter";
import axios from "axios";
import { Alert } from "react-native";

jest.mock("@react-native-async-storage/async-storage", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

jest.mock("@/constants/Constants", () => ({
  ...jest.requireActual("@/constants/Constants"),
  TOKEN_URL: "https://auth.example.com/token",
}));

jest.mock("@/utils/authTokenStore", () => ({
  loadAuthDataFromSecureStore: jest.fn(async () => ({
    accessToken: "access-token",
  })),
  saveAuthDataToSecureStore: jest.fn(),
}));

jest.mock("@/utils/tokenExpiry", () => ({
  isTokenExpired: jest.fn(() => false),
}));

jest.mock("@/services/tokenRefresh", () => ({
  refreshAccessToken: jest.fn(),
}));

jest.mock("axios", () => ({ post: jest.fn() }));

const mockPost = axios.post as jest.Mock;
const dispatch = jest.fn();

const exchange = () =>
  tokenExchange(dispatch, "notification-client", "", "", "app-1");

const collectReachability = () => {
  const seen: boolean[] = [];
  const off = reachabilityEmitter.on(Event.AuthReachability, (v) =>
    seen.push(v as boolean)
  );
  return { seen, off };
};

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  mockPost.mockReset();
  dispatch.mockClear();
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The micro-app screen tells the user and offers "Try again" when an exchange fails, so an
// Alert from here would stack a second prompt on top of it.
describe("when the exchange fails", () => {
  it("reports a request that never reached the server as unreachable, without an Alert", async () => {
    mockPost.mockRejectedValue(
      Object.assign(new Error("Network Error"), { isAxiosError: true })
    );
    const { seen, off } = collectReachability();

    await expect(exchange()).resolves.toBeNull();
    off();

    expect(alertSpy).not.toHaveBeenCalled();
    expect(seen).toEqual([false]);
  });

  it("returns null without an Alert when the server refused, which still proves it reachable", async () => {
    mockPost.mockRejectedValue(
      Object.assign(new Error("Request failed with status code 400"), {
        isAxiosError: true,
        response: { status: 400 },
      })
    );
    const { seen, off } = collectReachability();

    await expect(exchange()).resolves.toBeNull();
    off();

    expect(alertSpy).not.toHaveBeenCalled();
    expect(seen).toEqual([true]);
  });
});

it("reports the backend reachable and stores the tokens when the exchange succeeds", async () => {
  mockPost.mockResolvedValue({
    status: 200,
    data: { access_token: "exchanged", id_token: "exchanged-id" },
  });
  const { seen, off } = collectReachability();

  await expect(exchange()).resolves.toEqual({
    accessToken: "exchanged",
    idToken: "exchanged-id",
  });
  off();

  expect(seen).toEqual([true]);
  expect(dispatch).toHaveBeenCalledTimes(2);
});
