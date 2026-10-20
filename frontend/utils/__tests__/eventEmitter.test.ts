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
import { authEmitter, qrScannerEmitter } from "@/utils/eventEmitter";

describe("qrScannerEmitter (existing behavior, guards against regressions)", () => {
  afterEach(() => {
    qrScannerEmitter.removeAllListeners();
  });

  it("calls a subscribed handler with the emitted payload", () => {
    const handler = jest.fn();
    qrScannerEmitter.on(Event.QrScanned, handler);

    qrScannerEmitter.emit(Event.QrScanned, "some-qr-payload");

    expect(handler).toHaveBeenCalledWith("some-qr-payload");
  });

  it("stops calling a handler after the returned unsubscribe is invoked", () => {
    const handler = jest.fn();
    const unsubscribe = qrScannerEmitter.on(Event.QrScanned, handler);

    unsubscribe();
    qrScannerEmitter.emit(Event.QrScanned, "some-qr-payload");

    expect(handler).not.toHaveBeenCalled();
  });

  it("does not throw when emitting with no listeners", () => {
    expect(() => qrScannerEmitter.emit(Event.QrScanned, "x")).not.toThrow();
  });
});

describe("authEmitter", () => {
  afterEach(() => {
    authEmitter.removeAllListeners();
  });

  it("is a distinct instance from qrScannerEmitter", () => {
    expect(authEmitter).not.toBe(qrScannerEmitter);
  });

  it("passes a subscriber the session signal emitted on Event.AuthSession", () => {
    const handler = jest.fn();
    authEmitter.on(Event.AuthSession, handler);

    authEmitter.emit(Event.AuthSession, { status: "expired" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ status: "expired" });
  });

  it("does not leak events to qrScannerEmitter subscribers", () => {
    const qrHandler = jest.fn();
    qrScannerEmitter.on(Event.QrScanned, qrHandler);

    authEmitter.emit(Event.AuthSession, { status: "expired" });

    expect(qrHandler).not.toHaveBeenCalled();
  });

  it("stops notifying a subscriber after unsubscribing", () => {
    const handler = jest.fn();
    const unsubscribe = authEmitter.on(Event.AuthSession, handler);

    unsubscribe();
    authEmitter.emit(Event.AuthSession, { status: "expired" });

    expect(handler).not.toHaveBeenCalled();
  });
});
