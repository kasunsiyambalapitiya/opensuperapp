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

import ExpoModulesCore
import PassKit

/**
 Hosts one `PKAddPassButton`, sized to the React Native view's bounds.

 The control is resizable: its rounded-rect background fills whatever frame it
 is given and the wallet glyph plus label stay centred in it, switching from a
 two-line to a one-line layout once there is room. It draws and localises its
 own label, so nothing here touches the title, colours or corner radius, and
 nothing here dims it — the JS side swaps the whole control out for a spinner
 instead.
 */
public final class AppleWalletButtonView: ExpoView {
  // Named after the event declared in the module definition; the dispatcher is
  // matched to it by property name.
  private let onAddPassPress = EventDispatcher()

  private var addPassButton: PKAddPassButton?

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    // PassKit's UI half is not present on every platform this target can be
    // built for, and a missing class must not take the screen down. Substituting
    // our own artwork is not an option (Apple's badge is for web, email and
    // print only), so an unavailable control renders as an empty view and the JS
    // side keeps its other save affordances.
    guard NSClassFromString("PKAddPassButton") != nil else {
      return
    }

    let button = PKAddPassButton(addPassButtonStyle: .black)
    button.frame = bounds
    button.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    button.addTarget(self, action: #selector(addPassButtonPressed), for: .touchUpInside)

    addSubview(button)
    addPassButton = button
  }

  func setAddPassButtonStyle(_ style: AddPassButtonStyle) {
    addPassButton?.addPassButtonStyle = style.pkStyle
  }

  @objc
  private func addPassButtonPressed() {
    onAddPassPress()
  }
}
