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
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Linking } from "react-native";

// Google Wallet exposes no "is this object saved?" API to a third-party app —
// the native module's hasPass rejects with UNSUPPORTED_PLATFORM on Android —
// so the only thing available is what this device last did. Keyed by serial
// number so switching accounts on a shared device does not inherit the
// previous employee's answer.
const ADDED_KEY_PREFIX = "wallet_pass_added:";

// The https URL, not a package-targeted launch. React Native's openURL only
// ever builds Intent(ACTION_VIEW, Uri.parse(url)) — it never calls
// Intent.parseUri — so an `intent://` URI is treated as a scheme nothing
// registers and openURL simply rejects. Targeting the Wallet package properly
// would mean expo-intent-launcher plus an Android 11+ <queries> manifest entry,
// which is not worth it here: Google Wallet claims wallet.google.com as an app
// link, so an installed app opens on this URL anyway and a device without it
// lands on the web wallet instead of a dead button.
const GOOGLE_WALLET_WEB_URL = "https://wallet.google.com/";

const addedKey = (serialNumber: string): string =>
  `${ADDED_KEY_PREFIX}${serialNumber}`;

/**
 * Whether this device has saved the employee's card to Google Wallet.
 *
 * This is a record of what the app did, not a reading of the wallet. Google
 * offers no way to ask, so an employee who deleted the card from Google Wallet
 * still counts as having it until they add it again. The "Add again" action in
 * the card footer exists for exactly that case.
 *
 * @param {string} serialNumber - The pass serial number, the JWT `userid`.
 * @returns {Promise<boolean>} True when this device saved the card.
 */
export const isPassInWallet = async (
  serialNumber: string,
): Promise<boolean> => {
  if (!serialNumber) {
    return false;
  }

  try {
    return (await AsyncStorage.getItem(addedKey(serialNumber))) !== null;
  } catch (error) {
    console.warn("Could not read the saved-to-wallet marker.", error);
    return false;
  }
};

/**
 * Records that the card was handed to Google Wallet.
 *
 * Optimistic by necessity: the save happens in Google's own UI after the app
 * opens the save link, and nothing reports back whether the employee confirmed
 * it there.
 *
 * @param {string} serialNumber - The pass serial number, the JWT `userid`.
 * @returns {Promise<void>} Resolves once the marker is written.
 */
export const markPassAdded = async (serialNumber: string): Promise<void> => {
  if (!serialNumber) {
    return;
  }

  try {
    await AsyncStorage.setItem(
      addedKey(serialNumber),
      new Date().toISOString(),
    );
  } catch (error) {
    // Losing the marker only means the add button stays on screen, so this is
    // not worth failing the save the employee just completed.
    console.warn("Could not record the saved-to-wallet marker.", error);
  }
};

/**
 * Opens Google Wallet — the installed app via its app link, the web wallet
 * otherwise.
 *
 * There is no deep link to one specific object without its Google-side object
 * id, which the app never sees, so this lands on the wallet rather than on the
 * card itself. The serial number is still required, to keep one contract
 * across both platforms and to refuse the action when there is no card to open.
 *
 * @param {string} serialNumber - The pass serial number, the JWT `userid`.
 * @returns {Promise<boolean>} True when the wallet opened.
 */
export const openPassInWallet = async (
  serialNumber: string,
): Promise<boolean> => {
  if (!serialNumber) {
    return false;
  }

  try {
    await Linking.openURL(GOOGLE_WALLET_WEB_URL);
    return true;
  } catch (error) {
    console.error("Could not open Google Wallet.", error);
    return false;
  }
};
