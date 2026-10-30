// Copyright (c) 2025 WSO2 LLC. (https://www.wso2.com).
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
import React from "react";
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  useColorScheme,
  View,
} from "react-native";
import SignInMessage from "./SignInMessage";

/**
 * Props for the SignInModal component.
 */
interface SignInModalProps {
  /** Determines if the modal is visible */
  visible: boolean;

  /** Callback to close the modal */
  onClose: () => void;

  /** Heading and body passed to SignInMessage; its defaults apply when left out. */
  title?: string;
  message?: string;

  /** Label of a secondary button that closes the modal; none is shown when left out. */
  dismissLabel?: string;
}

/**
 * SignInModal is a reusable modal component for prompting the user to sign in.
 * It darkens the background and shows a styled card in the center.
 * Tapping outside the modal content dismisses the modal.
 *
 * @param {boolean} visible - Controls whether the modal is shown.
 * @param {() => void} onClose - Callback triggered when the modal is dismissed.
 */
const SignInModal: React.FC<SignInModalProps> = React.memo(
  ({ visible, onClose, title, message, dismissLabel }) => {
    const colorScheme = useColorScheme();
    const styles = createStyles(colorScheme ?? "light");

    return (
      <Modal
        transparent
        visible={visible}
        animationType="fade"
        onRequestClose={onClose}
        onDismiss={onClose}
      >
        {/* Tapping outside the modal view triggers onClose */}
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.overlay}>
            {/* Prevent propagation of touches from closing the modal */}
            <View style={styles.modal}>
              <SignInMessage title={title} message={message} />
              {dismissLabel && (
                <TouchableOpacity
                  style={styles.dismissButton}
                  onPress={onClose}
                  activeOpacity={0.5}
                  accessibilityRole="button"
                  accessibilityLabel={dismissLabel}
                >
                  <Text style={styles.dismissText}>{dismissLabel}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    );
  }
);

/**
 * Dynamically generates styles based on the current color scheme.
 *
 * @param {string | null | undefined} colorScheme - 'light' or 'dark' theme.
 * @returns {object} - A StyleSheet object.
 */
const createStyles = (colorScheme: "light" | "dark") =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: Colors[colorScheme].overLayColor,
      justifyContent: "center",
      alignItems: "center",
    },
    modal: {
      backgroundColor: Colors[colorScheme].primaryBackgroundColor,
      padding: 30,
      borderRadius: 16,
      borderWidth: 0.5,
      borderColor: Colors[colorScheme].overLayColor,
      width: "90%",
      alignItems: "center",
    },
    icon: {
      marginBottom: 8,
    },
    title: {
      fontSize: 18,
      fontWeight: "bold",
      color: Colors[colorScheme].text,
      marginBottom: 10,
    },
    message: {
      fontSize: 16,
      textAlign: "center",
      marginBottom: 30,
      color: Colors[colorScheme].primaryTextColor,
    },
    button: {
      backgroundColor: Colors.companyOrange,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 12,
      paddingVertical: 12,
      width: "80%",
      marginBottom: 10,
    },
    buttonText: {
      fontSize: 16,
      lineHeight: 20,
      color: Colors[colorScheme].primaryBackgroundColor,
      fontWeight: "600",
    },
    dismissButton: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 12,
      width: "80%",
    },
    dismissText: {
      fontSize: 16,
      lineHeight: 20,
      color: Colors[colorScheme].primaryTextColor,
      fontWeight: "600",
    },
  });

export default SignInModal;
