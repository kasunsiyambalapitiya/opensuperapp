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
import SessionExpiredPrompt from "@/components/SessionExpiredPrompt";
import { SessionStatus } from "@/types/auth.types";
import React from "react";
import { Modal, Text } from "react-native";
import { Provider } from "react-redux";
import { createStore } from "redux";
import { act, create, ReactTestRenderer } from "react-test-renderer";

jest.mock("@react-native-async-storage/async-storage", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);
// Forwarded rather than returned: the factory runs while the component is imported,
// before this const is initialised.
const mockSignIn = jest.fn();
jest.mock("@/hooks/useSignInWithAsgardeo", () => ({
  useSignInWithAsgardeo:
    () =>
    (...args: unknown[]) =>
      mockSignIn(...args),
}));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));
// react-redux's package.json "react-native" export condition points at an
// ESM build this project's Jest transform can't parse; the "default"
// (alternate-renderers) condition resolves to the same API via CommonJS.
jest.mock("react-redux", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("react-redux/alternate-renderers")
);

type AuthSnapshot = {
  sessionStatus: SessionStatus;
  rotationLost: boolean;
  isEndingSession?: boolean;
};
type SetAuth = { type: "set"; auth: AuthSnapshot };

const buildStore = (auth: AuthSnapshot) =>
  createStore(
    (
      state: { auth: AuthSnapshot } = { auth },
      action: SetAuth | { type: string }
    ) => (action.type === "set" ? { auth: (action as SetAuth).auth } : state)
  );

const mount = (
  sessionStatus: SessionStatus,
  rotationLost = false,
  isEndingSession = false
) => {
  const store = buildStore({ sessionStatus, rotationLost, isEndingSession });
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <Provider store={store}>
        <SessionExpiredPrompt />
      </Provider>
    );
  });
  const setStatus = (status: SessionStatus) =>
    act(() => {
      store.dispatch({
        type: "set",
        auth: { sessionStatus: status, rotationLost },
      });
    });
  const finishEnding = () =>
    act(() => {
      store.dispatch({
        type: "set",
        auth: { sessionStatus, rotationLost, isEndingSession: false },
      });
    });
  return { tree, setStatus, finishEnding };
};

const texts = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(Text).map((node) => String(node.props.children));

const isShown = (tree: ReactTestRenderer) => texts(tree).length > 0;

// Async, so the sign-in button's own loading state settles inside act.
const press = async (tree: ReactTestRenderer, label: string) => {
  const [button] = tree.root.findAll(
    (node) =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === "function"
  );
  await act(async () => {
    await button.props.onPress();
  });
};

beforeEach(() => {
  mockSignIn.mockReset().mockResolvedValue(undefined);
});

describe("SessionExpiredPrompt", () => {
  it("asks the user to sign in again when the session has expired", () => {
    const { tree } = mount("expired");

    expect(isShown(tree)).toBe(true);
    expect(texts(tree).join(" ")).toMatch(/session has expired/i);
  });

  it.each<SessionStatus>([
    "signedOut",
    "degraded",
    "restoring",
    "authenticated",
    "refreshing",
  ])("stays out of the way when the session is %s", (status) => {
    // A sign-out was the user's own doing, and a degraded session is still theirs.
    expect(isShown(mount(status).tree)).toBe(false);
  });

  it("waits for the expired session to be cleared before offering a sign-in", () => {
    const { tree, finishEnding } = mount("expired", false, true);
    expect(isShown(tree)).toBe(false);

    finishEnding();

    expect(isShown(tree)).toBe(true);
  });

  it("says the sign-in was lost to the connection when that is what happened", () => {
    const expired = texts(mount("expired", false).tree).join(" ");
    const lost = texts(mount("expired", true).tree).join(" ");

    expect(lost).toMatch(/connection/i);
    expect(lost).not.toEqual(expired);
    expect(expired).not.toMatch(/connection/i);
  });

  it("opens the Asgardeo sign-in from its primary action", async () => {
    const { tree } = mount("expired");

    await press(tree, "Sign in");

    expect(mockSignIn).toHaveBeenCalledTimes(1);
  });

  it("stays up after a sign-in that did not complete, so the user can try again", async () => {
    // useSignInWithAsgardeo swallows a cancel or a failure and leaves the session expired.
    const { tree } = mount("expired");

    await press(tree, "Sign in");

    expect(isShown(tree)).toBe(true);
  });

  it("goes away on Not now and leaves the user signed out", async () => {
    const { tree } = mount("expired");

    await press(tree, "Not now");

    expect(isShown(tree)).toBe(false);
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it("goes away by itself once a new session starts", () => {
    const { tree, setStatus } = mount("expired");

    setStatus("authenticated");

    expect(isShown(tree)).toBe(false);
  });

  it("asks again the next time a session expires, after Not now", async () => {
    const { tree, setStatus } = mount("expired");

    await press(tree, "Not now");
    setStatus("authenticated");
    setStatus("expired");

    expect(isShown(tree)).toBe(true);
  });

  it("asks again the next time, even though iOS reports the last one dismissed late", () => {
    const { tree, setStatus } = mount("expired");

    setStatus("authenticated");
    // iOS calls onDismiss once the hide animation is over, after the sign-in hid it.
    act(() => {
      tree.root.findByType(Modal).props.onDismiss();
    });
    setStatus("expired");

    expect(isShown(tree)).toBe(true);
  });
});
