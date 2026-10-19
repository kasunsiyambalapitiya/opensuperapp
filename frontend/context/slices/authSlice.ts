// Copyright (c) 2025 WSO2 LLC. (https://www.wso2.com).
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
import { removeGoogleAuthState } from "@/services/googleService";
import { syncMicroAppCacheForUser } from "@/utils/microAppCacheStore";
import { SessionEnd, SessionStatus } from "@/types/auth.types";
import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";
import { getItemAsync, setItemAsync } from "expo-secure-store";
import { AuthData, loadAuthData } from "../../services/authService";
import { refreshAccessToken } from "../../services/tokenRefresh";
import { getAppConfigurations } from "./appConfigSlice";

export interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  email: AuthData["email"] | null;
  userId: AuthData["userId"] | null;
  isLoading: boolean;
  sessionStatus: SessionStatus;
  /** The session that ended was lost to a rotation whose reply never arrived. */
  rotationLost: boolean;
}

export type { SessionStatus };

const initialState: AuthState = {
  accessToken: null,
  refreshToken: null,
  idToken: null,
  email: null,
  userId: null,
  isLoading: false,
  sessionStatus: "restoring",
  rotationLost: false,
};

const SIGNED_IN_STATUSES: SessionStatus[] = [
  "authenticated",
  "refreshing",
  "degraded",
];
const ENDED_STATUSES: SessionStatus[] = ["expired", "signedOut"];

const clearTokens = (state: AuthState) => {
  state.accessToken = null;
  state.refreshToken = null;
  state.idToken = null;
  state.email = null;
  state.userId = null;
};

const setAuthenticated = (state: AuthState, authData: AuthData) => {
  state.accessToken = authData.accessToken;
  state.refreshToken = authData.refreshToken;
  state.idToken = authData.idToken;
  state.email = authData.email;
  state.userId = authData.userId;
  state.isLoading = false;
  state.sessionStatus = "authenticated";
  state.rotationLost = false;
};

// Async action to restore persisted auth state
export const restoreAuth = createAsyncThunk(
  "auth/restoreAuth",
  async (_, { dispatch }) => {
    let authData = await loadAuthData();
    if (!authData) return null;

    // An expired token is not put into Redux even for a moment: if the refresh fails,
    // nothing would ever take it out again. An expiresAt of 0 is what tokenRefresh
    // stores for claims it could not decode, and has to read as expired.
    const isExpired = Date.now() >= authData.expiresAt;
    if (isExpired) {
      authData = await refreshAccessToken();
      if (!authData) return null;
    }

    // Dispatched now rather than on fulfilled so screens are not held behind the
    // app configurations request below.
    dispatch(setAuth(authData));
    try {
      await dispatch(getAppConfigurations()).unwrap();
    } catch (configError) {
      console.error("Failed to load app configurations", configError);
    }

    return authData;
  }
);

// Async action to set auth and check Google auth state
export const setAuthWithCheck = createAsyncThunk(
  "auth/setAuthWithCheck",
  async (authPayload: AuthData, { dispatch }) => {
    const previousAuthMail = await getItemAsync("authMail");
    if (previousAuthMail) {
      const parsedMail = JSON.parse(previousAuthMail);
      if (authPayload.email && authPayload.email !== parsedMail) {
        await removeGoogleAuthState();
      }
    }

    await setItemAsync("authMail", JSON.stringify(authPayload.email));

    if (authPayload.userId) {
      await syncMicroAppCacheForUser(dispatch, authPayload.userId);
    }

    dispatch(setAuth(authPayload));
  }
);

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    /** A sign-in: starts a session whatever state the last one was left in. */
    setAuth: (state, action: PayloadAction<AuthData>) => {
      setAuthenticated(state, action.payload);
    },
    /**
     * A refresh's new tokens. A refresh still in flight when the session ended must not
     * bring it back; only a sign-in (setAuth) starts a new one.
     */
    setRefreshedAuth: (state, action: PayloadAction<AuthData>) => {
      if (ENDED_STATUSES.includes(state.sessionStatus)) return;
      setAuthenticated(state, action.payload);
    },
    setSessionEnd: (state, action: PayloadAction<SessionEnd>) => {
      state.sessionStatus = action.payload.status;
      state.rotationLost =
        action.payload.status === "expired" && action.payload.rotationLost;
    },
    setSessionStatus: (state, action: PayloadAction<SessionStatus>) => {
      // Only a sign-in (setAuth) starts a new session. A refresh still in flight when
      // the last one ended must not bring it back.
      if (
        ENDED_STATUSES.includes(state.sessionStatus) &&
        !ENDED_STATUSES.includes(action.payload)
      ) {
        return;
      }
      state.sessionStatus = action.payload;
    },
    resetAll: () => initialState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(restoreAuth.fulfilled, (state, action) => {
        if (action.payload) {
          state.accessToken = action.payload.accessToken;
          state.refreshToken = action.payload.refreshToken;
          state.idToken = action.payload.idToken;
          state.email = action.payload.email;
          state.userId = action.payload.userId;
          state.sessionStatus = "authenticated";
        } else {
          clearTokens(state);
          // A failed refresh has already said whether the session is degraded or
          // expired; only a restore that found nothing to refresh is signed out.
          if (state.sessionStatus === "restoring") {
            state.sessionStatus = "signedOut";
          }
        }
        state.isLoading = false;
      })
      .addCase(restoreAuth.rejected, (state) => {
        if (state.sessionStatus === "restoring") {
          state.sessionStatus = "signedOut";
        }
        state.isLoading = false;
      })
      .addCase(setAuthWithCheck.fulfilled, (state) => {
        state.isLoading = false;
      });
  },
});

type StateWithAuth = { auth: AuthState };

export const selectSessionStatus = (state: StateWithAuth) =>
  state.auth.sessionStatus;

/** Signed in, even if the token is being refreshed or the network is down. */
export const selectIsSignedIn = (state: StateWithAuth) =>
  SIGNED_IN_STATUSES.includes(state.auth.sessionStatus);

/** Expired or signed out: the user has to sign in before anything works again. */
export const selectHasSessionEnded = (state: StateWithAuth) =>
  ENDED_STATUSES.includes(state.auth.sessionStatus);

export const {
  setAuth,
  setRefreshedAuth,
  setSessionEnd,
  setSessionStatus,
  resetAll,
} = authSlice.actions;
export default authSlice.reducer;
