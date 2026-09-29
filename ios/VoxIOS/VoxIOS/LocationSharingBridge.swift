import Foundation
import UIKit
@preconcurrency import WebKit

/// Answers `window.voxNativeIOS.locationSharing` (defined in PairingBridge's
/// script). Every call returns a promise; invalid input rejects it.
final class LocationSharingBridge: NSObject, WKScriptMessageHandlerWithReply {
    static let handlerName = "voxLocationSharing"

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame,
              origin.protocol == "https",
              origin.host == AppConfiguration.trustedHost,
              let body = message.body as? [String: Any],
              let type = body["type"] as? String else {
            replyHandler(nil, "Unsupported request.")
            return
        }

        switch type {
        case "status":
            Task { @MainActor in replyHandler(LocationSharing.shared.status(), nil) }
        case "enable":
            let deviceId = body["deviceId"] as? String ?? ""
            let token = body["token"] as? String ?? ""
            Task { @MainActor in
                do {
                    replyHandler(try await LocationSharing.shared.enable(deviceId: deviceId, token: token), nil)
                } catch {
                    replyHandler(nil, error.localizedDescription)
                }
            }
        case "disable":
            Task { @MainActor in replyHandler(LocationSharing.shared.disable(), nil) }
        case "pingNow":
            Task { @MainActor in replyHandler(await LocationSharing.shared.pingNow(), nil) }
        case "requestAlways":
            // iOS shows the "Always" prompt only once; after that only Settings can change it.
            Task { @MainActor in
                _ = await LocationReminderScheduler.shared.requestAlwaysPermission()
                replyHandler(LocationSharing.shared.status(), nil)
            }
        case "openSettings":
            Task { @MainActor in
                guard let url = URL(string: UIApplication.openSettingsURLString) else {
                    replyHandler(false, nil)
                    return
                }
                replyHandler(await UIApplication.shared.open(url), nil)
            }
        default:
            replyHandler(nil, "Unsupported request.")
        }
    }
}
