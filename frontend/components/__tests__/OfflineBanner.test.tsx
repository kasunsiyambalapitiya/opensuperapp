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
import OfflineBanner from "@/components/OfflineBanner";
import { Event } from "@/constants/enums/Event";
import { reachabilityEmitter } from "@/utils/eventEmitter";
import React from "react";
import { AccessibilityInfo, Text } from "react-native";
import { act, create, ReactTestRenderer } from "react-test-renderer";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 0, left: 0, right: 0 }),
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
    tree = create(<OfflineBanner />);
  });
  return tree;
};

const messageOf = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(Text).map((node) => node.props.children);

afterEach(() => {
  reachabilityEmitter.removeAllListeners(Event.AuthReachability);
  jest.restoreAllMocks();
});

describe("OfflineBanner", () => {
  it("shows nothing until something has actually failed", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<OfflineBanner />);
    });

    expect(tree.toJSON()).toBeNull();
  });

  it("appears when the backend goes out of reach", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<OfflineBanner />);
    });

    emit(false);

    expect(tree.toJSON()).not.toBeNull();
    // The session is still valid here, so the copy must not read as a sign-out.
    const message = String(messageOf(tree)[0]);
    expect(message).toMatch(/No connection/i);
    expect(message).not.toMatch(/sign|log ?out|session/i);
  });

  it("goes away again once a request gets through", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<OfflineBanner />);
    });

    emit(false);
    emit(true);

    expect(tree.toJSON()).toBeNull();
  });

  it("appears when the device reports it is offline", () => {
    const tree = mount();

    setOnline(false);

    expect(tree.toJSON()).not.toBeNull();
    expect(String(messageOf(tree)[0])).toMatch(/No connection/i);
  });

  it("goes away when the device comes back online", () => {
    const tree = mount();

    setOnline(false);
    setOnline(true);

    expect(tree.toJSON()).toBeNull();
  });

  // A failed request is evidence from before the reconnect. Without this the bar would sit
  // there until the next request happened to go out, which can be an hour away.
  it("drops a stale reachability failure when the device reconnects", () => {
    const tree = mount();

    emit(false);
    setOnline(false);
    setOnline(true);

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

    expect(tree.toJSON()).not.toBeNull();
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
    expect(announce.mock.calls[0][0]).toMatch(/No connection/i);
    expect(announce.mock.calls[0][0]).not.toMatch(/sign|log ?out|session/i);
  });

  it("stops listening when it unmounts", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<OfflineBanner />);
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
