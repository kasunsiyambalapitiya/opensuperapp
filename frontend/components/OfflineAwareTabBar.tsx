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
import OfflineToast from "@/components/OfflineToast";
import {
  BottomTabBar,
  BottomTabBarHeightCallbackContext,
  BottomTabBarProps,
} from "@react-navigation/bottom-tabs";
import { useContext, useEffect, useState } from "react";

/**
 * The stock tab bar with the offline toast floating just above it.
 *
 * The toast stays up for the whole outage, so while it shows its height is added to the
 * bar's in what the navigator is told. Screens already keep their composer and the end of
 * their lists clear of `useBottomTabBarHeight()`, and so clear of the toast too.
 */
const OfflineAwareTabBar = (props: BottomTabBarProps) => {
  const reportHeight = useContext(BottomTabBarHeightCallbackContext);
  const [barHeight, setBarHeight] = useState(0);
  const [toastHeight, setToastHeight] = useState(0);
  const [toastVisible, setToastVisible] = useState(false);

  // Not before the bar has measured itself: the navigator's own estimate is closer than 0.
  useEffect(() => {
    if (!barHeight) return;
    reportHeight?.(barHeight + (toastVisible ? toastHeight : 0));
  }, [reportHeight, barHeight, toastHeight, toastVisible]);

  return (
    <>
      <BottomTabBarHeightCallbackContext.Provider value={setBarHeight}>
        <BottomTabBar {...props} />
      </BottomTabBarHeightCallbackContext.Provider>
      <OfflineToast
        bottom={barHeight}
        onHeight={setToastHeight}
        onVisibleChange={setToastVisible}
      />
    </>
  );
};

export default OfflineAwareTabBar;
