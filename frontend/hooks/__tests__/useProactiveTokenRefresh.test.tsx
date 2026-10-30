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
import { useProactiveTokenRefresh } from "@/hooks/useProactiveTokenRefresh";
import { SessionStatus } from "@/types/auth.types";
import { CLOCK_SKEW_MS } from "@/utils/tokenExpiry";
import { AppState, AppStateStatus } from "react-native";
import { act, create, ReactTestRenderer } from "react-test-renderer";

const mockRefreshAccessToken = jest.fn();
jest.mock("@/services/tokenRefresh", () => ({
  refreshAccessToken: () => mockRefreshAccessToken(),
}));

// The real selectors come from authSlice; these keep its import graph free of native
// modules.
jest.mock("@/services/authService", () => ({}));
jest.mock("@/services/googleService", () => ({}));
jest.mock("@/utils/microAppCacheStore", () => ({}));
jest.mock("@/context/slices/appConfigSlice", () => ({}));

let mockConnectivityListener: ((online: boolean) => void) | undefined;
jest.mock("@/utils/connectivity", () => ({
  subscribeToConnectivity: (listener: (online: boolean) => void) => {
    mockConnectivityListener = listener;
    return () => {
      mockConnectivityListener = undefined;
    };
  },
}));

// Just the slice of state the hook reads; the selectors are the real ones.
let mockState: {
  auth: { sessionStatus: SessionStatus; accessToken: string | null };
};
const mockStore = { getState: () => mockState };
jest.mock("react-redux", () => ({
  useSelector: (selector: (state: unknown) => unknown) => selector(mockState),
  useStore: () => mockStore,
}));

let appStateListener: ((state: AppStateStatus) => void) | undefined;
const removeAppStateListener = jest.fn(() => {
  appStateListener = undefined;
});

const jwt = (claims: { iat: number; exp: number }) =>
  ["none", JSON.stringify(claims), "sig"]
    .map((part) => Buffer.from(part).toString("base64url"))
    .join(".");

const MINUTE = 60 * 1000;
const START = 1_750_000_000 * 1000;
const LIFETIME = 60 * MINUTE;

/** A one-hour token issued `ago` ms before the clock's current time. */
const tokenIssued = (ago = 0) => {
  const iat = Math.floor((Date.now() - ago) / 1000);
  return jwt({ iat, exp: iat + LIFETIME / 1000 });
};

// When a token issued at START is due, counted from START.
const DUE_AFTER = 0.8 * LIFETIME - CLOCK_SKEW_MS;

function TestHost() {
  useProactiveTokenRefresh();
  return null;
}

let tree: ReactTestRenderer | undefined;

const render = () => {
  act(() => {
    if (tree) tree.update(<TestHost />);
    else tree = create(<TestHost />);
  });
};

const setSession = (
  sessionStatus: SessionStatus,
  accessToken: string | null
) => {
  mockState = { auth: { sessionStatus, accessToken } };
  render();
};

const advance = (ms: number) => {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
};

// Moves the clock without firing timers, as a phone that slept with the app suspended.
const sleepFor = (ms: number) => {
  jest.setSystemTime(Date.now() + ms);
};

const foreground = () => {
  act(() => appStateListener?.("active"));
};

const setOnline = (online: boolean) => {
  act(() => mockConnectivityListener?.(online));
};

beforeEach(() => {
  jest.useFakeTimers({ now: START });
  mockRefreshAccessToken.mockReset().mockResolvedValue(null);
  appStateListener = undefined;
  removeAppStateListener.mockClear();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, listener) => {
    appStateListener = listener;
    return { remove: removeAppStateListener };
  });
  mockState = { auth: { sessionStatus: "signedOut", accessToken: null } };
});

afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("useProactiveTokenRefresh", () => {
  describe("the timer", () => {
    it("refreshes when the token reaches 80% of its lifetime, and not before", () => {
      setSession("authenticated", tokenIssued());

      advance(DUE_AFTER - 1);
      expect(mockRefreshAccessToken).not.toHaveBeenCalled();

      advance(1);
      expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
    });

    it("reschedules for the new token after a refresh", () => {
      setSession("authenticated", tokenIssued());

      // Off the periodic check's 5-minute beat, so only the timer can be what fires.
      advance(DUE_AFTER - 7 * MINUTE);
      // A request refreshed it early; the old token's due point no longer matters.
      setSession("authenticated", tokenIssued());

      advance(7 * MINUTE);
      expect(mockRefreshAccessToken).not.toHaveBeenCalled();

      advance(DUE_AFTER - 7 * MINUTE - 1);
      expect(mockRefreshAccessToken).not.toHaveBeenCalled();

      advance(1);
      expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
    });
  });

  it("refreshes at once a token that is already due when the session starts", () => {
    setSession("authenticated", tokenIssued(0.9 * LIFETIME));

    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("does not refresh a fresh token when the session starts", () => {
    setSession("authenticated", tokenIssued());

    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });

  // A token that is due the moment it arrives - a device clock well ahead of the
  // server's - must not become back-to-back refreshes.
  it("does not refresh again just because a refresh brought a token that is already due", () => {
    setSession("authenticated", tokenIssued(0.9 * LIFETIME));
    setSession("authenticated", tokenIssued(0.9 * LIFETIME));
    advance(MINUTE);

    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
  });

  describe("coming back to the foreground", () => {
    it("refreshes a token that fell due while the app was suspended", () => {
      setSession("authenticated", tokenIssued());

      sleepFor(DUE_AFTER);
      foreground();

      expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
    });

    it("leaves a token that is not due alone", () => {
      setSession("authenticated", tokenIssued());

      sleepFor(DUE_AFTER / 2);
      foreground();

      expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    });

    it("checks again only once the cooldown has passed", () => {
      setSession("authenticated", tokenIssued());

      sleepFor(DUE_AFTER);
      foreground();
      sleepFor(5 * 1000);
      foreground();
      expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);

      sleepFor(30 * 1000);
      foreground();
      expect(mockRefreshAccessToken).toHaveBeenCalledTimes(2);
    });

    it("ignores the app going to the background", () => {
      setSession("authenticated", tokenIssued());

      sleepFor(DUE_AFTER);
      act(() => appStateListener?.("background"));

      expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    });
  });

  it("checks periodically, so a refresh that failed is tried again", () => {
    setSession("authenticated", tokenIssued());

    advance(DUE_AFTER);
    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);

    advance(5 * MINUTE);
    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(2);
  });

  it("refreshes a session that has no token yet, as one restored without a connection", () => {
    setSession("degraded", null);

    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
  });

  describe("offline", () => {
    it("does nothing until the device reconnects, then checks", () => {
      render();
      setOnline(false);
      setSession("authenticated", tokenIssued(0.9 * LIFETIME));

      advance(30 * MINUTE);
      foreground();
      expect(mockRefreshAccessToken).not.toHaveBeenCalled();

      setOnline(true);
      expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
    });

    it("drops a timer that was waiting when the connection went", () => {
      setSession("authenticated", tokenIssued());
      setOnline(false);

      advance(DUE_AFTER);

      expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    });
  });

  describe("while signed out", () => {
    it.each(["restoring", "signedOut", "expired"] as const)(
      "does nothing while %s",
      (status) => {
        setSession(status, tokenIssued(0.9 * LIFETIME));

        advance(LIFETIME);
        foreground();
        setOnline(false);
        setOnline(true);

        expect(mockRefreshAccessToken).not.toHaveBeenCalled();
        expect(appStateListener).toBeUndefined();
        expect(jest.getTimerCount()).toBe(0);
      }
    );

    it("stops everything when the session ends", () => {
      setSession("authenticated", tokenIssued());
      setSession("expired", null);

      expect(removeAppStateListener).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);

      advance(LIFETIME);
      setOnline(false);
      setOnline(true);
      expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    });
  });

  it("stops everything when it unmounts", () => {
    setSession("authenticated", tokenIssued());

    act(() => tree?.unmount());
    tree = undefined;

    expect(removeAppStateListener).toHaveBeenCalledTimes(1);
    expect(mockConnectivityListener).toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });
});
