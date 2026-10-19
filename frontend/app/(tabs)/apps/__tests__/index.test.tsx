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
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);
jest.mock("@/services/appStoreService", () => ({
  loadMicroAppDetails: jest.fn(),
  downloadMicroApp: jest.fn(),
  removeMicroApp: jest.fn(),
}));
jest.mock("@/context/slices/userConfigSlice", () => ({
  getUserConfigurations: () => ({ type: "userConfig/mock" }),
}));
jest.mock("@react-navigation/bottom-tabs", () => ({
  ...jest.requireActual("@react-navigation/bottom-tabs"),
  useBottomTabBarHeight: () => 0,
}));
jest.mock("@/hooks/useTrackActiveScreen", () => ({
  useTrackActiveScreen: jest.fn(),
}));
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useFocusEffect: jest.fn(),
}));
jest.mock("@/hooks/useSignInWithAsgardeo", () => ({
  useSignInWithAsgardeo: () => jest.fn(),
}));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));
// react-redux's package.json "react-native" export condition points at an
// ESM build this project's Jest transform can't parse; the "default"
// (alternate-renderers) condition resolves to the same API via CommonJS.
jest.mock("react-redux", () => require("react-redux/alternate-renderers"));

import SignInMessage from "@/components/SignInMessage";
import { SessionStatus } from "@/types/auth.types";
import React from "react";
import { FlatList } from "react-native";
import { Provider } from "react-redux";
import { createStore } from "redux";
import { act, create, ReactTestRenderer } from "react-test-renderer";
import HomeScreen from "../index";

const baseState = {
  apps: { apps: [], downloading: [], downloadProgress: {} },
  auth: {
    accessToken: null as string | null,
    refreshToken: null,
    idToken: null,
    email: null,
    userId: null,
    isLoading: false,
    sessionStatus: "signedOut" as SessionStatus,
  },
  appConfig: {
    configs: [],
    defaultMicroAppIds: [],
    appScopes: [],
    loading: false,
    error: null,
  },
  version: { versions: [], loading: false, error: null },
  userConfig: { configurations: [], loading: false },
};

const buildStore = (
  sessionStatus: SessionStatus,
  accessToken: string | null
) =>
  createStore(() => ({
    ...baseState,
    auth: { ...baseState.auth, sessionStatus, accessToken },
  }));

const renderHomeScreen = async (
  sessionStatus: SessionStatus,
  accessToken: string | null = null
) => {
  const store = buildStore(sessionStatus, accessToken);
  let renderer: ReactTestRenderer;

  jest.useFakeTimers();
  await act(async () => {
    renderer = create(
      <Provider store={store}>
        <HomeScreen />
      </Provider>
    );
  });
  // FlatList/VirtualizedList schedules a delayed cell-render update via
  // setTimeout on mount; flush it now so it doesn't fire after the test ends.
  act(() => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();

  return renderer!;
};

// React.memo() without a custom comparator collapses to a SimpleMemoComponent
// fiber whose reported `type` is the inner render function, not the memo
// wrapper object, so findAllByType needs the unwrapped function to match.
const signInMessageType = (SignInMessage as unknown as { type: unknown }).type;

const expectSignInGate = (renderer: ReactTestRenderer) => {
  expect(renderer.root.findAllByType(signInMessageType as never).length).toBe(1);
  expect(renderer.root.findAllByType(FlatList).length).toBe(0);
};

const expectAppGrid = (renderer: ReactTestRenderer) => {
  expect(renderer.root.findAllByType(FlatList).length).toBe(1);
  expect(renderer.root.findAllByType(signInMessageType as never).length).toBe(0);
};

describe("HomeScreen auth gate", () => {
  it("shows SignInMessage and no app grid when signed out", async () => {
    expectSignInGate(await renderHomeScreen("signedOut"));
  });

  it("shows SignInMessage and no app grid when the session has expired", async () => {
    expectSignInGate(await renderHomeScreen("expired"));
  });

  it("shows the app grid and no SignInMessage when signed in", async () => {
    expectAppGrid(await renderHomeScreen("authenticated", "some-token"));
  });

  it("keeps the app grid while a refresh is in flight", async () => {
    expectAppGrid(await renderHomeScreen("refreshing", "some-token"));
  });

  it("keeps the app grid when the network is down, even with no token in Redux", async () => {
    // A cold start without signal restores degraded with Redux auth cleared;
    // the session is still there and the cached apps are still the user's.
    expectAppGrid(await renderHomeScreen("degraded", null));
  });

  it("gates on the session, not on a token left behind in Redux", async () => {
    expectSignInGate(await renderHomeScreen("expired", "stale-token"));
  });
});

describe("HomeScreen initial load", () => {
  const { loadMicroAppDetails } = jest.requireMock(
    "@/services/appStoreService"
  ) as { loadMicroAppDetails: jest.Mock };

  beforeEach(() => loadMicroAppDetails.mockClear());

  it("loads the apps for a session restored offline, which has no userId in Redux", async () => {
    await renderHomeScreen("degraded", null);
    expect(loadMicroAppDetails).toHaveBeenCalledTimes(1);
  });

  it("does not load the apps once the session has ended", async () => {
    await renderHomeScreen("expired", null);
    expect(loadMicroAppDetails).not.toHaveBeenCalled();
  });
});
