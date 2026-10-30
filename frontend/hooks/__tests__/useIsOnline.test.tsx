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
import { useIsOnline } from "@/hooks/useIsOnline";
import { act, create, ReactTestRenderer } from "react-test-renderer";

const mockUnsubscribe = jest.fn();
let mockListener: ((online: boolean) => void) | undefined;
jest.mock("@/utils/connectivity", () => ({
  subscribeToConnectivity: (listener: (online: boolean) => void) => {
    mockListener = listener;
    return mockUnsubscribe;
  },
}));

let seen: boolean[] = [];

function TestHost() {
  seen.push(useIsOnline());
  return null;
}

const mount = () => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<TestHost />);
  });
  return tree;
};

beforeEach(() => {
  seen = [];
  mockListener = undefined;
  mockUnsubscribe.mockClear();
});

describe("useIsOnline", () => {
  it("assumes online until NetInfo says otherwise", () => {
    mount();

    expect(seen).toEqual([true]);
  });

  it("follows connectivity changes", () => {
    mount();

    act(() => mockListener?.(false));
    act(() => mockListener?.(true));

    expect(seen).toEqual([true, false, true]);
  });

  it("unsubscribes when it unmounts", () => {
    const tree = mount();
    act(() => tree.unmount());

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
