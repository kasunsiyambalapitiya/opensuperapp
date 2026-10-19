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
import { processNativeAuthResult } from "@/services/authService";
import { saveAuthDataToSecureStore } from "@/utils/authTokenStore";
import { clearInterruptedRefresh } from "@/utils/rotationGuard";
import { AuthorizeResult } from "react-native-app-auth";

jest.mock("@react-native-async-storage/async-storage", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);
jest.mock("@/utils/authTokenStore", () => ({
  loadAuthDataFromSecureStore: jest.fn(),
  saveAuthDataToSecureStore: jest.fn(),
}));
jest.mock("@/utils/rotationGuard", () => ({
  clearInterruptedRefresh: jest.fn(),
}));
jest.mock("@/services/tokenRefresh", () => ({
  refreshAccessToken: jest.fn(),
}));
jest.mock("jwt-decode", () => ({
  jwtDecode: () => ({ email: "user@example.com", userid: "user-1", exp: 1 }),
}));

const AUTH_RESULT = {
  accessToken: "access-token",
  idToken: "id-token",
  refreshToken: "refresh-token",
} as AuthorizeResult;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("processNativeAuthResult", () => {
  // A marker left by the last session's interrupted refresh would make this session's
  // eventual expiry read as a lost rotation it never had.
  it("forgets an earlier interrupted refresh once a sign-in has stored fresh tokens", async () => {
    await expect(processNativeAuthResult(AUTH_RESULT)).resolves.toMatchObject({
      accessToken: "access-token",
    });

    expect(clearInterruptedRefresh).toHaveBeenCalled();
    expect(
      (clearInterruptedRefresh as jest.Mock).mock.invocationCallOrder[0]
    ).toBeGreaterThan(
      (saveAuthDataToSecureStore as jest.Mock).mock.invocationCallOrder[0]
    );
  });

  it("keeps the marker when the sign-in did not produce tokens", async () => {
    await processNativeAuthResult({
      ...AUTH_RESULT,
      accessToken: "",
    } as AuthorizeResult);

    expect(clearInterruptedRefresh).not.toHaveBeenCalled();
  });
});
