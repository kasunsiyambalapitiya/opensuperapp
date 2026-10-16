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
  isPassInWallet,
  markPassAdded,
  openPassInWallet,
} from "@/services/wallet/passPresence";
import { useCallback, useEffect, useState } from "react";

export type WalletPassPresence = {
  /** Whether the card is already in the wallet, so the add action is done. */
  inWallet: boolean;
  /** Records an add, then re-asks the wallet whether it really landed. */
  markAdded: () => Promise<void>;
  /** Opens the wallet on the card. */
  openInWallet: () => Promise<void>;
  /** Puts the add action back, for a card the wallet no longer has. */
  addAgain: () => void;
};

/**
 * Tracks whether the employee's business card is already in their wallet.
 *
 * Checked when the card sheet opens rather than once at mount: the sheet stays
 * mounted while hidden, and the employee can delete the card from the wallet
 * while the app is backgrounded, so an answer from the last time it was shown
 * is not one to trust. What "already in the wallet" means differs per platform
 * — see `services/wallet/passPresence.ios.ts` and `.android.ts`.
 *
 * @param {boolean} visible - Whether the business card sheet is showing.
 * @param {string | undefined} serialNumber - Pass serial number, the JWT `userid`.
 * @returns {WalletPassPresence} Presence state and the actions that change it.
 */
export const useWalletPassPresence = (
  visible: boolean,
  serialNumber: string | undefined,
): WalletPassPresence => {
  const [inWallet, setInWallet] = useState(false);

  // An answer is about one serial number and says nothing about the next one,
  // so it goes when the serial does. Keyed on the serial rather than folded
  // into the check below, which also reruns on every open and would flash the
  // add button back onto a card the wallet is about to confirm it holds.
  useEffect(() => {
    setInWallet(false);
  }, [serialNumber]);

  useEffect(() => {
    if (!visible || !serialNumber) {
      return;
    }

    // The sheet can close, or the employee can sign out, before the wallet
    // answers. Setting state on that stale answer would flip the footer of a
    // card that is no longer the one being shown.
    let active = true;
    isPassInWallet(serialNumber).then((present) => {
      if (active) {
        setInWallet(present);
      }
    });

    return () => {
      active = false;
    };
  }, [visible, serialNumber]);

  // The add is recorded and then checked, never assumed. On iOS the native add
  // reports success as soon as the add-pass controller is *presented*, not when
  // the employee taps Add, so flipping on that word alone would offer "Open in
  // Apple Wallet" for a pass PassKit was never given — and `addAgain` is not
  // wired up on iOS, so there is no way back from that short of reopening the
  // card sheet. One re-query covers both platforms: iOS asks PassKit, Android
  // reads the marker just written.
  //
  // The tradeoff is the opposite error. PassKit may not have registered the
  // pass by the time its sheet is dismissed, so a genuine add can still read as
  // absent here. That is the error worth having: it leaves the add button up,
  // which the next open re-checks and the employee can simply tap again,
  // whereas overstating presence is the dead end. So the answer is taken at
  // face value rather than being widened by the add's own say-so.
  const markAdded = useCallback(async () => {
    if (!serialNumber) {
      return;
    }
    await markPassAdded(serialNumber);
    setInWallet(await isPassInWallet(serialNumber));
  }, [serialNumber]);

  const openInWallet = useCallback(async () => {
    if (!serialNumber) {
      return;
    }
    await openPassInWallet(serialNumber);
  }, [serialNumber]);

  // Android cannot ask Google Wallet what it holds, so its answer is only what
  // this device last did. This is the way back for an employee who deleted the
  // card and is now looking at an "Open" button for something that is gone.
  const addAgain = useCallback(() => setInWallet(false), []);

  return { inWallet, markAdded, openInWallet, addAgain };
};
