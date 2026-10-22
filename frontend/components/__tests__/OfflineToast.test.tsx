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
import OfflineToast from "@/components/OfflineToast";
import { Event } from "@/constants/enums/Event";
import { OfflineStatusProvider } from "@/context/OfflineStatusContext";
import { reachabilityEmitter } from "@/utils/eventEmitter";
import React from "react";
import { AccessibilityInfo, Text } from "react-native";
import { act, create, ReactTestRenderer } from "react-test-renderer";

// The real icon set pulls in expo-font, which has nothing to load from under jest.
jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
  MaterialIcons: () => null,
}));

let mockConnectivityListener: ((online: boolean) => void) | undefined;
jest.mock("@/utils/connectivity", () => ({
  subscribeToConnectivity: (listener: (online: boolean) => void) => {
    mockConnectivityListener = listener;
    return () => {
      mockConnectivityListener = undefined;
    };
  },
}));

const Toast = () => (
  <OfflineStatusProvider>
    <OfflineToast bottom={0} />
  </OfflineStatusProvider>
);

const emit = (reachable: boolean) =>
  act(() => {
    reachabilityEmitter.emit(Event.AuthReachability, reachable);
  });

const setOnline = (online: boolean) =>
  act(() => {
    mockConnectivityListener?.(online);
  });

const mount = () => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<Toast />);
  });
  return tree;
};

// Long enough for any slide in or out to finish.
const settle = () =>
  act(() => {
    jest.advanceTimersByTime(1000);
  });

const wait = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms);
  });

const dismiss = (tree: ReactTestRenderer) =>
  act(() => {
    tree.root
      .find((node) => node.props.accessibilityLabel === "Dismiss" && node.props.onPress)
      .props.onPress();
  });

const shownToasts = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) => node.props.accessibilityRole === "alert" && typeof node.type === "string"
  ).length;

const messageOf = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(Text).map((node) => node.props.children);

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  reachabilityEmitter.removeAllListeners(Event.AuthReachability);
  jest.restoreAllMocks();
});

describe("OfflineToast", () => {
  it("shows nothing until something has actually failed", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<Toast />);
    });

    expect(tree.toJSON()).toBeNull();
  });

  it("appears when the backend goes out of reach", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<Toast />);
    });

    emit(false);

    expect(tree.toJSON()).not.toBeNull();
    // The session is still valid here, so the copy must not read as a sign-out.
    const message = String(messageOf(tree)[0]);
    expect(message).toMatch(/No internet connection/i);
    expect(message).not.toMatch(/sign|log ?out|session/i);
  });

  it("goes away again once a request gets through", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<Toast />);
    });

    emit(false);
    emit(true);
    settle();

    expect(tree.toJSON()).toBeNull();
  });

  it("says what is wrong, then what it means, on separate lines", () => {
    const tree = mount();

    setOnline(false);

    expect(messageOf(tree)).toEqual([
      "No internet connection",
      "Certain features might not work as expected.",
    ]);
  });

  it("appears when the device reports it is offline", () => {
    const tree = mount();

    setOnline(false);

    expect(tree.toJSON()).not.toBeNull();
    expect(String(messageOf(tree)[0])).toMatch(/No internet connection/i);
  });

  it("goes away when the device comes back online", () => {
    const tree = mount();

    setOnline(false);
    setOnline(true);
    settle();

    expect(tree.toJSON()).toBeNull();
  });

  // A failed request is evidence from before the reconnect. Without this the toast would sit
  // there until the next request happened to go out, which can be an hour away.
  it("drops a stale reachability failure when the device reconnects", () => {
    const tree = mount();

    emit(false);
    setOnline(false);
    setOnline(true);
    settle();

    expect(tree.toJSON()).toBeNull();
  });

  it("keeps a reachability failure that comes after the reconnect", () => {
    const tree = mount();

    setOnline(false);
    setOnline(true);
    // Online by the radio, but behind a captive portal: the request still failed.
    emit(false);

    expect(tree.toJSON()).not.toBeNull();
  });

  it("stays up while the device is offline, whatever the last request did", () => {
    const tree = mount();

    setOnline(false);
    emit(true);
    settle();

    expect(tree.toJSON()).not.toBeNull();
  });

  it("stays up for as long as the outage lasts", () => {
    const tree = mount();

    setOnline(false);
    wait(10 * 60 * 1000);

    expect(tree.toJSON()).not.toBeNull();
  });

  it("goes away by itself when given a time to auto-hide after", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <OfflineStatusProvider>
          <OfflineToast bottom={0} autoHideMs={4000} />
        </OfflineStatusProvider>
      );
    });

    setOnline(false);
    wait(3999);
    expect(tree.toJSON()).not.toBeNull();

    wait(1);
    settle();
    expect(tree.toJSON()).toBeNull();
  });

  // The micro app's toast and the tab bar's are on different screens; putting one away
  // says nothing about the other.
  it("leaves the other screens' toasts up when one is dismissed or hides itself", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <OfflineStatusProvider>
          <OfflineToast bottom={0} autoHideMs={4000} />
          <OfflineToast bottom={0} />
          <OfflineToast bottom={0} />
        </OfflineStatusProvider>
      );
    });

    setOnline(false);
    act(() => {
      tree.root
        .findAll((node) => node.props.accessibilityLabel === "Dismiss" && node.props.onPress)[2]
        .props.onPress();
    });
    wait(4000);
    settle();

    expect(shownToasts(tree)).toBe(1);
  });

  // Opening a micro app while still offline is a new screen the user has not been told on.
  it("shows on a screen opened during an outage that was dismissed elsewhere", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <OfflineStatusProvider>
          <OfflineToast bottom={0} />
        </OfflineStatusProvider>
      );
    });

    setOnline(false);
    dismiss(tree);
    settle();
    act(() => {
      tree.update(
        <OfflineStatusProvider>
          <OfflineToast bottom={0} />
          <OfflineToast bottom={0} autoHideMs={4000} />
        </OfflineStatusProvider>
      );
    });
    settle();

    expect(shownToasts(tree)).toBe(1);
  });

  it("goes away when dismissed", () => {
    const tree = mount();

    setOnline(false);
    dismiss(tree);
    settle();

    expect(tree.toJSON()).toBeNull();
  });

  it("does not come back while the same outage goes on", () => {
    const tree = mount();

    setOnline(false);
    dismiss(tree);
    // Another failed request during the same outage is not news.
    emit(false);
    settle();

    expect(tree.toJSON()).toBeNull();
  });

  it("comes back for the next outage", () => {
    const tree = mount();

    setOnline(false);
    dismiss(tree);
    setOnline(true);
    setOnline(false);
    settle();

    expect(tree.toJSON()).not.toBeNull();
  });

  it("does not block taps outside the toast itself", () => {
    const tree = mount();

    setOnline(false);
    settle();

    expect(tree.toJSON()).toMatchObject({ props: { pointerEvents: "box-none" } });
  });

  it("is announced once on iOS when it appears, where a live region does nothing", () => {
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {});
    // jest-expo already stubs it with a jest.fn, which spyOn hands back with its history.
    announce.mockClear();
    mount();

    setOnline(false);
    emit(false);

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce.mock.calls[0][0]).toMatch(/No internet connection/i);
    expect(announce.mock.calls[0][0]).not.toMatch(/sign|log ?out|session/i);
  });

  it("stops listening when it unmounts", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<Toast />);
    });
    act(() => {
      tree.unmount();
    });
    expect(mockConnectivityListener).toBeUndefined();

    // A setState on an unmounted component would warn; nothing should reach it.
    const warn = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => emit(false)).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
