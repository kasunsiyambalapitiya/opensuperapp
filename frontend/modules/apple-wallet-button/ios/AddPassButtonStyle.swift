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
 The two cases of `PKAddPassButtonStyle`, as strings for the JS side. PassKit
 defines no others: `PKAddPassButtonStyleBlack` for light backgrounds and
 `PKAddPassButtonStyleBlackOutline` for dark ones. There is deliberately no
 "custom" case — the system owns the artwork.
 */
enum AddPassButtonStyle: String, Enumerable {
  case black
  case blackOutline

  var pkStyle: PKAddPassButtonStyle {
    switch self {
    case .black:
      return .black
    case .blackOutline:
      return .blackOutline
    }
  }
}
