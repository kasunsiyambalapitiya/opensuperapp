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
import OfflineAwareTabBar from "@/components/OfflineAwareTabBar";
import OfflineToast from "@/components/OfflineToast";
import { Event } from "@/constants/enums/Event";
import { OfflineStatusProvider } from "@/context/OfflineStatusContext";
import { reachabilityEmitter } from "@/utils/eventEmitter";
import {
  BottomTabBarHeightCallbackContext,
  BottomTabBarProps,
} from "@react-navigation/bottom-tabs";
import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";

const TAB_BAR_HEIGHT = 83;
const TOAST_HEIGHT = 58;

// Stands in for the stock bar: reports a fixed height the way the real one does on layout.
jest.mock("@react-navigation/bottom-tabs", () => {
  const actual = jest.requireActual("@react-navigation/bottom-tabs");
  const { useContext, useEffect } = jest.requireActual("react");
  return {
    ...actual,
    BottomTabBar: () => {
      const onHeightChange = useContext(actual.BottomTabBarHeightCallbackContext);
      useEffect(() => onHeightChange?.(83), [onHeightChange]);
      return null;
    },
  };
});

// The real icon set pulls in expo-font, which has nothing to load from under jest.
jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
  MaterialIcons: () => null,
}));

jest.mock("@/utils/connectivity", () => ({
  subscribeToConnectivity: () => () => {},
}));

const mount = () => {
  const reportHeight = jest.fn();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <OfflineStatusProvider>
        <BottomTabBarHeightCallbackContext.Provider value={reportHeight}>
          <OfflineAwareTabBar {...({} as BottomTabBarProps)} />
        </BottomTabBarHeightCallbackContext.Provider>
      </OfflineStatusProvider>
    );
  });
  return { tree, reportHeight };
};

const emit = (reachable: boolean) =>
  act(() => {
    reachabilityEmitter.emit(Event.AuthReachability, reachable);
  });

const layOutToast = (tree: ReactTestRenderer, height: number) =>
  act(() => {
    tree.root
      .findByType(OfflineToast)
      .find((node) => typeof node.props.onLayout === "function")
      .props.onLayout({ nativeEvent: { layout: { height } } });
  });

// The toast's slide-out would otherwise finish after the test has.
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  reachabilityEmitter.removeAllListeners(Event.AuthReachability);
});

describe("OfflineAwareTabBar", () => {
  it("passes the tab bar's height on to the navigator", () => {
    const { reportHeight } = mount();

    expect(reportHeight).toHaveBeenLastCalledWith(TAB_BAR_HEIGHT);
  });

  it("floats the toast just above the tab bar", () => {
    const { tree } = mount();

    emit(false);

    expect(tree.root.findByType(OfflineToast).props.bottom).toBe(TAB_BAR_HEIGHT);
  });

  // The toast stays for the whole outage, so the screens keep their composer and the end of
  // their lists above it, through the same height they already pad for the bar.
  it("adds the toast's height while it shows", () => {
    const { tree, reportHeight } = mount();

    emit(false);
    layOutToast(tree, TOAST_HEIGHT);

    expect(reportHeight).toHaveBeenLastCalledWith(TAB_BAR_HEIGHT + TOAST_HEIGHT);
  });

  it("goes back to the bar's own height once the toast is dismissed", () => {
    const { tree, reportHeight } = mount();

    emit(false);
    layOutToast(tree, TOAST_HEIGHT);
    act(() => {
      tree.root
        .find((node) => node.props.accessibilityLabel === "Dismiss" && node.props.onPress)
        .props.onPress();
    });

    expect(reportHeight).toHaveBeenLastCalledWith(TAB_BAR_HEIGHT);
  });

  it("goes back to the bar's own height once the connection returns", () => {
    const { tree, reportHeight } = mount();

    emit(false);
    layOutToast(tree, TOAST_HEIGHT);
    emit(true);

    expect(reportHeight).toHaveBeenLastCalledWith(TAB_BAR_HEIGHT);
  });
});
