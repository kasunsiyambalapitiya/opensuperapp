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
import { restoreAuth } from "@/context/slices/authSlice";
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
  try {
    await handleFreshInstall();
    await runMigrations(); // Runs any migrations.
    const [savedApps, savedUserInfo] = await Promise.all([
      AsyncStorage.getItem(APPS),
      getItemAsync(USER_INFO),
    ]);

    if (savedApps) {
      dispatch(setApps(await buildAppsWithTokens(JSON.parse(savedApps))));
    }

    if (savedUserInfo) {
      dispatch(setUserInfo(JSON.parse(savedUserInfo)));
    }

    dispatch(getVersions());
    dispatch(getUserConfigurations());
  } catch (error) {
    console.error("Initialization error:", error);
  }

  // Whatever happened above: until this runs the session is "restoring", which every
  // screen reads as neither signed in nor signed out.
  try {
    await dispatch(restoreAuth()).unwrap();
  } catch (error) {
    console.error("Restoring the session failed:", error);
  }
};
