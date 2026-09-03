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
import {
  useWalletPassPresence,
  WalletPassPresence,
} from "@/hooks/useWalletPassPresence";
import React from "react";
import { act, create } from "react-test-renderer";

const mockIsPassInWallet = jest.fn();
const mockMarkPassAdded = jest.fn();
const mockOpenPassInWallet = jest.fn();

// What "already in the wallet" means is the platform module's problem — PassKit
// on iOS, a remembered marker on Android. All the hook owes is when it asks and
// what it does with the answer.
jest.mock("@/services/wallet/passPresence", () => ({
  isPassInWallet: (...args: unknown[]) => mockIsPassInWallet(...args),
  markPassAdded: (...args: unknown[]) => mockMarkPassAdded(...args),
  openPassInWallet: (...args: unknown[]) => mockOpenPassInWallet(...args),
}));

const SERIAL = "3f0c1b2a-employee";
const OTHER_SERIAL = "8d41e7c5-employee";

type Probe = {
  presence: () => WalletPassPresence;
  show: (visible: boolean) => Promise<void>;
  switchSerial: (serialNumber: string | undefined) => Promise<void>;
};

const Presence = ({
  visible,
  serialNumber,
  report,
}: {
  visible: boolean;
  serialNumber: string | undefined;
  report: (presence: WalletPassPresence) => void;
}) => {
  report(useWalletPassPresence(visible, serialNumber));
  return null;
};

/**
 * Mounts the hook behind a probe that hands back its latest return value, and
 * lets a case reopen the sheet, or hand it another employee's card, the way
 * the card does.
 */
const renderPresence = async (
  visible: boolean,
  // Spelled out at every call site rather than defaulted: one case needs to
  // pass undefined, and a default parameter would quietly replace it.
  serialNumber: string | undefined,
): Promise<Probe> => {
  let presence: WalletPassPresence | undefined;
  const report = (next: WalletPassPresence) => {
    presence = next;
  };

  let shown = visible;
  let serial = serialNumber;
  const element = () => (
    <Presence visible={shown} serialNumber={serial} report={report} />
  );

  let root: ReturnType<typeof create> | undefined;
  // The wallet answers on a promise, so every mount and update is flushed
  // inside an async act rather than asserted on the render that started it.
  await act(async () => {
    root = create(element());
  });

  return {
    presence: () => presence!,
    show: async (next: boolean) => {
      shown = next;
      await act(async () => {
        root!.update(element());
      });
    },
    switchSerial: async (next: string | undefined) => {
      serial = next;
      await act(async () => {
        root!.update(element());
      });
    },
  };
};

/** A wallet answer the case holds back, to assert on the state in between. */
const pendingAnswer = (): ((present: boolean) => void) => {
  let answer: (present: boolean) => void = () => {};
  mockIsPassInWallet.mockReturnValue(
    new Promise<boolean>((resolve) => {
      answer = resolve;
    }),
  );
  return (present) => answer(present);
};

beforeEach(() => {
  mockIsPassInWallet.mockReset().mockResolvedValue(false);
  mockMarkPassAdded.mockReset().mockResolvedValue(undefined);
  mockOpenPassInWallet.mockReset().mockResolvedValue(true);
});

describe("useWalletPassPresence", () => {
  // The sheet stays mounted while hidden, so a check at mount would be asking
  // about a card nobody is looking at.
  it("asks nothing while the card sheet is closed", async () => {
    const probe = await renderPresence(false, SERIAL);

    expect(mockIsPassInWallet).not.toHaveBeenCalled();
    expect(probe.presence().inWallet).toBe(false);
  });

  it("asks nothing without a serial number to ask about", async () => {
    const probe = await renderPresence(true, undefined);

    expect(mockIsPassInWallet).not.toHaveBeenCalled();
    expect(probe.presence().inWallet).toBe(false);
  });

  it("checks when the sheet opens and takes the wallet's answer", async () => {
    mockIsPassInWallet.mockResolvedValue(true);
    const probe = await renderPresence(false, SERIAL);

    await probe.show(true);

    expect(mockIsPassInWallet).toHaveBeenCalledWith(SERIAL);
    expect(probe.presence().inWallet).toBe(true);
  });

  it("leaves the add button up when the wallet does not have the card", async () => {
    const probe = await renderPresence(true, SERIAL);

    expect(probe.presence().inWallet).toBe(false);
  });

  it("records a completed add and flips without a second round trip", async () => {
    const probe = await renderPresence(true, SERIAL);
    expect(probe.presence().inWallet).toBe(false);

    await act(async () => {
      await probe.presence().markAdded();
    });

    expect(mockMarkPassAdded).toHaveBeenCalledWith(SERIAL);
    expect(probe.presence().inWallet).toBe(true);
    expect(mockIsPassInWallet).toHaveBeenCalledTimes(1);
  });

  // Android's answer is only what this device last did, so an employee who
  // deleted the card from Google Wallet needs the add button back.
  it("puts the add action back on Add again", async () => {
    mockIsPassInWallet.mockResolvedValue(true);
    const probe = await renderPresence(true, SERIAL);
    expect(probe.presence().inWallet).toBe(true);

    await act(async () => {
      probe.presence().addAgain();
    });

    expect(probe.presence().inWallet).toBe(false);
  });

  // The answer is about one card. Carrying it to the next serial would offer
  // "Open in Wallet" for a card the wallet has never been asked about.
  it("drops the previous card's answer when the serial changes", async () => {
    mockIsPassInWallet.mockResolvedValue(true);
    const probe = await renderPresence(true, SERIAL);
    expect(probe.presence().inWallet).toBe(true);

    const answer = pendingAnswer();
    await probe.switchSerial(OTHER_SERIAL);

    expect(probe.presence().inWallet).toBe(false);

    await act(async () => {
      answer(true);
    });
    expect(probe.presence().inWallet).toBe(true);
  });

  // Resetting on every open rather than on the serial would flash the add
  // button back onto a card the wallet is about to confirm it holds.
  it("keeps the answer while the same card's sheet is reopened", async () => {
    mockIsPassInWallet.mockResolvedValue(true);
    const probe = await renderPresence(true, SERIAL);
    expect(probe.presence().inWallet).toBe(true);

    const answer = pendingAnswer();
    await probe.show(false);
    await probe.show(true);

    expect(probe.presence().inWallet).toBe(true);

    await act(async () => {
      answer(true);
    });
    expect(probe.presence().inWallet).toBe(true);
  });

  it("opens the wallet on the card it is showing", async () => {
    const probe = await renderPresence(true, SERIAL);

    await act(async () => {
      await probe.presence().openInWallet();
    });

    expect(mockOpenPassInWallet).toHaveBeenCalledWith(SERIAL);
  });
});
