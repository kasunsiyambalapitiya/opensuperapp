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
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 0, left: 0, right: 0 }),
}));

import OfflineBanner from "@/components/OfflineBanner";
import { Event } from "@/constants/enums/Event";
import { reachabilityEmitter } from "@/utils/eventEmitter";
import React from "react";
import { Text } from "react-native";
import { act, create, ReactTestRenderer } from "react-test-renderer";

const emit = (reachable: boolean) =>
  act(() => {
    reachabilityEmitter.emit(Event.AuthReachability, reachable);
  });

const messageOf = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(Text).map((node) => node.props.children);

afterEach(() => {
  reachabilityEmitter.removeAllListeners(Event.AuthReachability);
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

  it("stops listening when it unmounts", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<OfflineBanner />);
    });
    act(() => {
      tree.unmount();
    });

    // A setState on an unmounted component would warn; nothing should reach it.
    const warn = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => emit(false)).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
