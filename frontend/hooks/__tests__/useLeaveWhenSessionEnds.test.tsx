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
import { useLeaveWhenSessionEnds } from "@/hooks/useLeaveWhenSessionEnds";
import { SessionStatus } from "@/types/auth.types";
import React from "react";
import { Provider } from "react-redux";
import { createStore } from "redux";
import { act, create } from "react-test-renderer";

jest.mock("@react-native-async-storage/async-storage", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);
// react-redux's package.json "react-native" export condition points at an
// ESM build this project's Jest transform can't parse; the "default"
// (alternate-renderers) condition resolves to the same API via CommonJS.
jest.mock("react-redux", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("react-redux/alternate-renderers")
);

type SetStatus = { type: "set"; sessionStatus: SessionStatus };

const Screen = ({ leave }: { leave: () => void }) => {
  useLeaveWhenSessionEnds(leave);
  return null;
};

const mount = (sessionStatus: SessionStatus) => {
  const store = createStore(
    (
      state: { auth: { sessionStatus: SessionStatus } } = {
        auth: { sessionStatus },
      },
      action: SetStatus | { type: string }
    ) =>
      action.type === "set"
        ? { auth: { sessionStatus: (action as SetStatus).sessionStatus } }
        : state
  );
  const leave = jest.fn();
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(
      <Provider store={store}>
        <Screen leave={leave} />
      </Provider>
    );
  });
  const setStatus = (status: SessionStatus) =>
    act(() => {
      store.dispatch({ type: "set", sessionStatus: status });
    });
  const rerender = (nextLeave: () => void) =>
    act(() => {
      tree.update(
        <Provider store={store}>
          <Screen leave={nextLeave} />
        </Provider>
      );
    });
  return { leave, setStatus, rerender };
};

describe("useLeaveWhenSessionEnds", () => {
  it.each<SessionStatus>(["expired", "signedOut"])(
    "leaves when the session becomes %s",
    (status) => {
      const { leave, setStatus } = mount("authenticated");

      setStatus(status);

      expect(leave).toHaveBeenCalledTimes(1);
    }
  );

  it("leaves straight away when the screen opens with no session", () => {
    expect(mount("signedOut").leave).toHaveBeenCalledTimes(1);
  });

  it.each<SessionStatus>([
    "restoring",
    "authenticated",
    "refreshing",
    "degraded",
  ])("stays while the session is %s", (status) => {
    // Restoring has decided nothing yet, and leaving on it would flicker every
    // cold start. Refreshing and degraded are still the user's session.
    const { leave } = mount(status);

    expect(leave).not.toHaveBeenCalled();
  });

  it("leaves once, however often the screen re-renders after the session ended", () => {
    const { leave, setStatus, rerender } = mount("authenticated");

    setStatus("expired");
    rerender(leave);
    rerender(leave);

    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("uses the latest leave it was given", () => {
    const { leave, setStatus, rerender } = mount("authenticated");
    const latest = jest.fn();

    rerender(latest);
    setStatus("expired");

    expect(leave).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });
});
