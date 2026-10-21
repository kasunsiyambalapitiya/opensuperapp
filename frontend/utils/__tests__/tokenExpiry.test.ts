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
import {
  CLOCK_SKEW_MS,
  isTokenExpired,
  refreshDueAt,
  shouldRefreshToken,
} from "@/utils/tokenExpiry";

// Unsigned, which is all jwt-decode looks at.
const jwt = (claims: { iat?: number; exp?: number }) =>
  [{ alg: "none" }, claims, "sig"]
    .map((part) =>
      Buffer.from(
        typeof part === "string" ? part : JSON.stringify(part)
      ).toString("base64url")
    )
    .join(".");

const ISSUED_AT_S = 1_750_000_000;
const LIFETIME_S = 3600;
const ISSUED_AT = ISSUED_AT_S * 1000;
const EXPIRES_AT = (ISSUED_AT_S + LIFETIME_S) * 1000;
const TOKEN = jwt({ iat: ISSUED_AT_S, exp: ISSUED_AT_S + LIFETIME_S });

// The point in the token's lifetime, as the server's clock would put it.
const at = (fraction: number) => ISSUED_AT + fraction * LIFETIME_S * 1000;

describe("shouldRefreshToken", () => {
  it("leaves a token alone until 80% of its lifetime is spent", () => {
    expect(shouldRefreshToken(TOKEN, at(0.79))).toBe(false);
  });

  it("refreshes once 80% of its lifetime is spent", () => {
    expect(shouldRefreshToken(TOKEN, at(0.8))).toBe(true);
  });

  it("refreshes a token that has already expired", () => {
    expect(shouldRefreshToken(TOKEN, EXPIRES_AT + 1)).toBe(true);
  });

  it("allows for a device clock running behind the server's", () => {
    const threshold = at(0.8);

    expect(shouldRefreshToken(TOKEN, threshold - CLOCK_SKEW_MS)).toBe(true);
    expect(shouldRefreshToken(TOKEN, threshold - CLOCK_SKEW_MS - 1)).toBe(
      false
    );
  });

  it("falls back to the expiry when the token does not say when it was issued", () => {
    const token = jwt({ exp: ISSUED_AT_S + LIFETIME_S });

    expect(shouldRefreshToken(token, at(0.95))).toBe(false);
    expect(shouldRefreshToken(token, EXPIRES_AT - CLOCK_SKEW_MS)).toBe(true);
  });

  it("falls back to the expiry when the issue time is not before it", () => {
    const token = jwt({
      iat: ISSUED_AT_S + LIFETIME_S,
      exp: ISSUED_AT_S + LIFETIME_S,
    });

    expect(shouldRefreshToken(token, at(0.95))).toBe(false);
    expect(shouldRefreshToken(token, EXPIRES_AT - CLOCK_SKEW_MS)).toBe(true);
  });

  it.each([
    ["no token", null],
    ["a token that is not a JWT", "opaque-token"],
    ["a JWT with no expiry", jwt({ iat: ISSUED_AT_S })],
  ])("refreshes when there is %s", (_, token) => {
    expect(shouldRefreshToken(token, ISSUED_AT)).toBe(true);
  });
});

describe("refreshDueAt", () => {
  it("is the 80% point, brought forward by the skew allowance", () => {
    expect(refreshDueAt(TOKEN)).toBe(at(0.8) - CLOCK_SKEW_MS);
  });

  it("is zero, due already, for a token that cannot be read", () => {
    expect(refreshDueAt("opaque-token")).toBe(0);
  });
});

describe("isTokenExpired", () => {
  it("is not expired late in its lifetime, past the refresh point", () => {
    expect(isTokenExpired(TOKEN, at(0.95))).toBe(false);
  });

  it("is expired from just inside the skew allowance before exp", () => {
    expect(isTokenExpired(TOKEN, EXPIRES_AT - CLOCK_SKEW_MS - 1)).toBe(false);
    expect(isTokenExpired(TOKEN, EXPIRES_AT - CLOCK_SKEW_MS)).toBe(true);
  });

  it("is expired after exp", () => {
    expect(isTokenExpired(TOKEN, EXPIRES_AT + 1)).toBe(true);
  });

  it("reads the clock when not given a time", () => {
    jest.useFakeTimers({ now: at(0.5) });
    try {
      expect(isTokenExpired(TOKEN)).toBe(false);
      expect(shouldRefreshToken(TOKEN)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    ["a token that is not a JWT", "opaque-token"],
    ["a JWT with no expiry", jwt({ iat: ISSUED_AT_S })],
  ])("treats %s as expired", (_, token) => {
    expect(isTokenExpired(token, ISSUED_AT)).toBe(true);
  });
});
