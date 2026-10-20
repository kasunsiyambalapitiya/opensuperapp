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
import authReducer, {
  restoreAuth,
  selectHasSessionEnded,
  selectIsSignedIn,
  selectSessionStatus,
  SessionStatus,
  setAuth,
  setRefreshedAuth,
  setSessionStatus,
} from "@/context/slices/authSlice";
import { AuthData } from "@/types/auth.types";
import { configureStore, UnknownAction } from "@reduxjs/toolkit";

const mockLoadAuthData = jest.fn();
jest.mock("@/services/authService", () => ({
  loadAuthData: (...args: unknown[]) => mockLoadAuthData(...args),
}));
const mockRefreshAccessToken = jest.fn();
jest.mock("@/services/tokenRefresh", () => ({
  refreshAccessToken: (...args: unknown[]) => mockRefreshAccessToken(...args),
}));
jest.mock("@/context/slices/appConfigSlice", () => ({
  getAppConfigurations: () => () => ({
    unwrap: () => Promise.resolve(),
  }),
}));
// Only setAuthWithCheck uses these; stubbed so the import graph stays free of
// native modules.
jest.mock("@/services/googleService", () => ({
  removeGoogleAuthState: jest.fn(),
}));
jest.mock("@/utils/microAppCacheStore", () => ({
  syncMicroAppCacheForUser: jest.fn(),
}));

const STORED: AuthData = {
  accessToken: "stored-access",
  refreshToken: "stored-refresh",
  idToken: "stored-id",
  email: "user@example.com",
  userId: "user-1",
  expiresAt: 0,
};

const REFRESHED: AuthData = {
  ...STORED,
  accessToken: "new-access",
  refreshToken: "new-refresh",
  idToken: "new-id",
  expiresAt: Number.MAX_SAFE_INTEGER,
};

const buildStore = () => {
  const actions: UnknownAction[] = [];
  const store = configureStore({
    reducer: { auth: authReducer },
    middleware: (getDefault) =>
      getDefault({ serializableCheck: false }).concat(
        () => (next: (action: unknown) => unknown) => (action: unknown) => {
          actions.push(action as UnknownAction);
          return next(action);
        }
      ),
  });
  return { store, actions };
};

const withStatus = (status: SessionStatus) => {
  const built = buildStore();
  built.store.dispatch(setSessionStatus(status));
  return built;
};

beforeEach(() => {
  mockLoadAuthData.mockReset();
  mockRefreshAccessToken.mockReset();
});

describe("session status", () => {
  it("starts as restoring, which is not yet signed in", () => {
    const { store } = buildStore();

    expect(selectSessionStatus(store.getState())).toBe("restoring");
    expect(selectIsSignedIn(store.getState())).toBe(false);
  });

  it("counts authenticated, refreshing and degraded as signed in", () => {
    const signedIn: SessionStatus[] = ["authenticated", "refreshing", "degraded"];
    for (const status of signedIn) {
      const { store } = withStatus(status);
      expect(selectIsSignedIn(store.getState())).toBe(true);
      expect(selectHasSessionEnded(store.getState())).toBe(false);
    }
  });

  it("counts expired and signedOut as ended and not signed in", () => {
    const ended: SessionStatus[] = ["expired", "signedOut"];
    for (const status of ended) {
      const { store } = withStatus(status);
      expect(selectIsSignedIn(store.getState())).toBe(false);
      expect(selectHasSessionEnded(store.getState())).toBe(true);
    }
  });

  it("becomes authenticated when tokens are set, from any status", () => {
    const all: SessionStatus[] = [
      "restoring",
      "refreshing",
      "degraded",
      "expired",
      "signedOut",
    ];
    for (const status of all) {
      const { store } = withStatus(status);
      store.dispatch(setAuth(REFRESHED));
      expect(selectSessionStatus(store.getState())).toBe("authenticated");
      expect(store.getState().auth.accessToken).toBe("new-access");
    }
  });

  it("moves between the live statuses freely", () => {
    const { store } = withStatus("authenticated");

    store.dispatch(setSessionStatus("refreshing"));
    expect(selectSessionStatus(store.getState())).toBe("refreshing");
    store.dispatch(setSessionStatus("degraded"));
    expect(selectSessionStatus(store.getState())).toBe("degraded");
    store.dispatch(setSessionStatus("expired"));
    expect(selectSessionStatus(store.getState())).toBe("expired");
  });

  it("keeps a degraded session's tokens: a bad network destroys nothing", () => {
    const { store } = buildStore();
    store.dispatch(setAuth(STORED));

    store.dispatch(setSessionStatus("degraded"));

    expect(store.getState().auth.accessToken).toBe("stored-access");
    expect(store.getState().auth.userId).toBe("user-1");
  });

  it("does not let a late refresh revive a session that has ended", () => {
    for (const ended of ["expired", "signedOut"] as SessionStatus[]) {
      const { store } = withStatus(ended);

      store.dispatch(setSessionStatus("refreshing"));
      store.dispatch(setSessionStatus("degraded"));

      expect(selectSessionStatus(store.getState())).toBe(ended);
    }
  });

  it("does not let a late refresh's tokens revive a session that has ended", () => {
    for (const ended of ["expired", "signedOut"] as SessionStatus[]) {
      const { store } = withStatus(ended);

      store.dispatch(setRefreshedAuth(REFRESHED));

      expect(selectSessionStatus(store.getState())).toBe(ended);
      expect(store.getState().auth.accessToken).toBeNull();
      expect(store.getState().auth.refreshToken).toBeNull();
    }
  });

  it("takes a refresh's tokens while the session is live", () => {
    const live: SessionStatus[] = [
      "restoring",
      "authenticated",
      "refreshing",
      "degraded",
    ];
    for (const status of live) {
      const { store } = withStatus(status);

      store.dispatch(setRefreshedAuth(REFRESHED));

      expect(selectSessionStatus(store.getState())).toBe("authenticated");
      expect(store.getState().auth.accessToken).toBe("new-access");
      expect(store.getState().auth.refreshToken).toBe("new-refresh");
    }
  });
});

describe("restoreAuth", () => {
  it("is signedOut, with auth cleared, when nothing is stored", async () => {
    const { store } = buildStore();
    // Whatever was in Redux before must not outlive a restore that found nothing.
    store.dispatch(setAuth(STORED));
    store.dispatch(setSessionStatus("restoring"));
    mockLoadAuthData.mockResolvedValue(null);

    await store.dispatch(restoreAuth());

    const { auth } = store.getState();
    expect(auth.sessionStatus).toBe("signedOut");
    expect(auth.accessToken).toBeNull();
    expect(auth.refreshToken).toBeNull();
    expect(auth.idToken).toBeNull();
    expect(auth.email).toBeNull();
    expect(auth.userId).toBeNull();
  });

  it("is authenticated with the stored tokens when they have not expired", async () => {
    const { store } = buildStore();
    mockLoadAuthData.mockResolvedValue({
      ...STORED,
      expiresAt: Date.now() + 60_000,
    });

    await store.dispatch(restoreAuth());

    expect(store.getState().auth.sessionStatus).toBe("authenticated");
    expect(store.getState().auth.accessToken).toBe("stored-access");
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });

  it("never puts an expired token into Redux, before or after the refresh", async () => {
    const { store, actions } = buildStore();
    mockLoadAuthData.mockResolvedValue(STORED);
    mockRefreshAccessToken.mockImplementation(async () => {
      expect(store.getState().auth.accessToken).toBeNull();
      return REFRESHED;
    });

    await store.dispatch(restoreAuth());

    const stale = actions.filter(
      (a) =>
        (a.payload as AuthData | undefined)?.accessToken === "stored-access"
    );
    expect(stale).toEqual([]);
    expect(store.getState().auth.accessToken).toBe("new-access");
    expect(store.getState().auth.sessionStatus).toBe("authenticated");
  });

  it("clears auth when the refresh fails, keeping the status the refresh reported", async () => {
    // tokenRefresh reports the outcome as it happens; a degraded session
    // restores with no usable token in Redux but is still signed in.
    const { store } = buildStore();
    mockLoadAuthData.mockResolvedValue(STORED);
    mockRefreshAccessToken.mockImplementation(async () => {
      store.dispatch(setSessionStatus("refreshing"));
      store.dispatch(setSessionStatus("degraded"));
      return null;
    });

    await store.dispatch(restoreAuth());

    expect(store.getState().auth.accessToken).toBeNull();
    expect(store.getState().auth.sessionStatus).toBe("degraded");
    expect(selectIsSignedIn(store.getState())).toBe(true);
  });

  it("stays expired when the refresh proves the session dead", async () => {
    const { store } = buildStore();
    mockLoadAuthData.mockResolvedValue(STORED);
    mockRefreshAccessToken.mockImplementation(async () => {
      store.dispatch(setSessionStatus("expired"));
      return null;
    });

    await store.dispatch(restoreAuth());

    expect(store.getState().auth.accessToken).toBeNull();
    expect(store.getState().auth.sessionStatus).toBe("expired");
  });

  it("is signedOut rather than stuck restoring when the stored tokens cannot be read", async () => {
    const { store } = buildStore();
    mockLoadAuthData.mockRejectedValue(new Error("keychain unavailable"));

    await store.dispatch(restoreAuth());

    expect(store.getState().auth.sessionStatus).toBe("signedOut");
  });
});
