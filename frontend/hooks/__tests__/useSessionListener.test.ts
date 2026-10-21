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
import { useSessionListener } from "@/hooks/useSessionListener";
import { AuthData } from "@/types/auth.types";
import { authEmitter } from "@/utils/eventEmitter";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

// Stubs mirroring the real action creators, so this suite is about which action
// each signal becomes and not about the reducers (authSlice.test covers those).
jest.mock("@/context/slices/authSlice", () => ({
  setRefreshedAuth: (payload: unknown) => ({
    type: "auth/setRefreshedAuth",
    payload,
  }),
  setSessionStatus: (payload: unknown) => ({
    type: "auth/setSessionStatus",
    payload,
  }),
}));
jest.mock("@/utils/endSession", () => ({
  endSession: (reason: unknown) => ({ type: "auth/endSession", payload: reason }),
}));

const mockDispatch = jest.fn();
jest.mock("react-redux", () => ({ useDispatch: () => mockDispatch }));

const AUTH_DATA: AuthData = {
  accessToken: "new-access",
  refreshToken: "new-refresh",
  idToken: "new-id",
  email: "user@example.com",
  userId: "user-1",
  expiresAt: 1,
};

function TestHost() {
  useSessionListener();
  return null;
}

const mount = () => {
  let root: ReturnType<typeof create> | undefined;
  act(() => {
    root = create(createElement(TestHost));
  });
  return root!;
};

describe("useSessionListener", () => {
  afterEach(() => {
    mockDispatch.mockClear();
    authEmitter.removeAllListeners();
  });

  it("subscribes on mount without dispatching anything yet", () => {
    mount();

    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("puts refreshed tokens into Redux", () => {
    mount();

    act(() => {
      authEmitter.emit(Event.AuthSession, {
        status: "authenticated",
        authData: AUTH_DATA,
      });
    });

    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "auth/setRefreshedAuth",
      payload: AUTH_DATA,
    });
  });

  it.each(["refreshing", "degraded"] as const)(
    "records %s as the session status and ends nothing",
    (status) => {
      mount();

      act(() => {
        authEmitter.emit(Event.AuthSession, { status });
      });

      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "auth/setSessionStatus",
        payload: status,
      });
    }
  );

  it.each([false, true])(
    "ends the session when it has expired, saying whether a rotation was lost (%s)",
    (rotationLost) => {
      mount();

      act(() => {
        authEmitter.emit(Event.AuthSession, { status: "expired", rotationLost });
      });

      // endSession's own condition drops a repeat, so the listener need not.
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "auth/endSession",
        payload: { status: "expired", rotationLost },
      });
    }
  );

  it("stops dispatching after unmount (cleanup unsubscribes)", () => {
    const root = mount();

    act(() => {
      root.unmount();
    });
    act(() => {
      authEmitter.emit(Event.AuthSession, {
        status: "expired",
        rotationLost: false,
      });
    });

    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
