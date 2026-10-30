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
import { useOfflineQueueReplay } from "@/hooks/useOfflineQueueReplay";
import { act, create, ReactTestRenderer } from "react-test-renderer";

const mockTeardown = jest.fn();
const mockSetup = jest.fn(() => mockTeardown);
jest.mock("@/utils/offlineQueue", () => ({
  setupOfflineQueueReplay: () => mockSetup(),
}));

function TestHost() {
  useOfflineQueueReplay();
  return null;
}

beforeEach(() => {
  mockSetup.mockClear();
  mockTeardown.mockClear();
});

describe("useOfflineQueueReplay", () => {
  it("starts replay once, however often the host re-renders", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<TestHost />);
    });
    act(() => {
      tree.update(<TestHost />);
    });

    expect(mockSetup).toHaveBeenCalledTimes(1);
    expect(mockTeardown).not.toHaveBeenCalled();
  });

  it("stops replay when the host unmounts", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<TestHost />);
    });
    act(() => {
      tree.unmount();
    });

    expect(mockTeardown).toHaveBeenCalledTimes(1);
  });
});
