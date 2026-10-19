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
import { Colors } from "@/constants/Colors";
import { Event } from "@/constants/enums/Event";
import { reachabilityEmitter } from "@/utils/eventEmitter";
import { useEffect, useState } from "react";
import { StyleSheet, Text, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Tells the user the backend is out of reach right now.
 *
 * Mounted once at the root, over every route. It reports a failing network and
 * nothing else — the session is still valid, so the copy must not read as a
 * sign-out.
 */
const OfflineBanner = () => {
  const colorScheme = useColorScheme() ?? "light";
  const styles = createStyles(colorScheme);
  const insets = useSafeAreaInsets();
  const [unreachable, setUnreachable] = useState(false);

  useEffect(
    () =>
      reachabilityEmitter.on(Event.AuthReachability, (reachable) =>
        setUnreachable(!reachable)
      ),
    []
  );

  if (!unreachable) {
    return null;
  }

  return (
    <View
      style={[styles.banner, { top: insets.top }]}
      // The bar floats over whatever screen is up, so it must not swallow a tap
      // meant for the content underneath it.
      pointerEvents="none"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Text style={styles.message}>
        No connection. Some things may not be up to date.
      </Text>
    </View>
  );
};

export default OfflineBanner;

const createStyles = (colorScheme: "light" | "dark") =>
  StyleSheet.create({
    banner: {
      position: "absolute",
      left: 0,
      right: 0,
      paddingHorizontal: 16,
      paddingVertical: 8,
      backgroundColor: Colors[colorScheme].secondaryBackgroundColor,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: Colors[colorScheme].borderColor,
      zIndex: 20,
      elevation: 20,
    },
    message: {
      fontSize: 14,
      textAlign: "center",
      color: Colors[colorScheme].text,
    },
  });
