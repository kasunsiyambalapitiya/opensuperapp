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
import { APPS, USER_INFO } from "@/constants/Constants";
import { setApps } from "@/context/slices/appSlice";
import { restoreAuth, setSessionEnd } from "@/context/slices/authSlice";
import { getUserConfigurations } from "@/context/slices/userConfigSlice";
import { setUserInfo } from "@/context/slices/userInfoSlice";
import { getVersions } from "@/context/slices/versionSlice";
import { AppDispatch } from "@/context/store";
import { runMigrations } from "@/migrations/migrator";
import { buildAppsWithTokens } from "@/utils/exchangedTokenRehydrator";
import { handleFreshInstall } from "@/utils/freshInstall";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getItemAsync } from "expo-secure-store";

/** The cold-start sequence the root layout runs once, before hiding the splash. */
export const initializeApp = async (dispatch: AppDispatch): Promise<void> => {
  // Unlike every other step, this one decides whether the credentials on disk belong to
  // this install at all. If it could not tell, they may be the last user's, left behind
  // by an uninstall, so nothing is restored: the session settles as signed out instead.
  let isInstallVerified = true;
  try {
    await handleFreshInstall();
  } catch (error) {
    console.error("Fresh-install check failed:", error);
    isInstallVerified = false;
  }

  try {
    await runMigrations(); // Runs any migrations.
    const [savedApps, savedUserInfo] = await Promise.all([
      AsyncStorage.getItem(APPS),
      getItemAsync(USER_INFO),
    ]);

    if (savedApps) {
      dispatch(setApps(await buildAppsWithTokens(JSON.parse(savedApps))));
    }

    // User info lives in SecureStore too, so it is as suspect as the tokens.
    if (savedUserInfo && isInstallVerified) {
      dispatch(setUserInfo(JSON.parse(savedUserInfo)));
    }

    dispatch(getVersions());
    dispatch(getUserConfigurations());
  } catch (error) {
    console.error("Initialization error:", error);
  }

  // Whatever happened above, the session has to settle: until it does it is
  // "restoring", which every screen reads as neither signed in nor signed out.
  if (!isInstallVerified) {
    dispatch(setSessionEnd({ status: "signedOut" }));
    return;
  }

  try {
    await dispatch(restoreAuth()).unwrap();
  } catch (error) {
    console.error("Restoring the session failed:", error);
  }
};
