import Foundation
import UserNotifications
@preconcurrency import WebKit

/// Lets the Vox web app schedule its pending reminders as iOS local
/// notifications. WKWebView has no Web Notification API, and local
/// notifications also fire while the app is closed.
final class ReminderNotificationBridge: NSObject, WKScriptMessageHandlerWithReply {
    static let handlerName = "voxReminders"
    private static let identifierPrefix = "vox-reminder-"
    /// iOS keeps at most 64 pending local notifications per app.
    private static let maximumScheduled = 60

    static func userScript() -> WKUserScript {
        let host = jsLiteral(AppConfiguration.trustedHost)
        let source = """
        (() => {
          if (location.protocol !== "https:" || location.host !== \(host)) return;
          const handler = window.webkit?.messageHandlers?.\(handlerName);
          if (!handler) return;
          Object.defineProperty(window, "voxNativeReminders", {
            value: Object.freeze({
              available: true,
              requestPermission: () => handler.postMessage({ type: "requestPermission" }),
              sync: (reminders) => handler.postMessage({ type: "sync", reminders }),
            }),
          });
        })();
        """
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

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
        case "requestPermission":
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
                DispatchQueue.main.async { replyHandler(granted ? "granted" : "denied", nil) }
            }
        case "sync":
            let reminders = (body["reminders"] as? [[String: Any]] ?? []).compactMap(ScheduledReminder.init)
            Self.schedule(reminders)
            replyHandler(reminders.count, nil)
        default:
            replyHandler(nil, "Unsupported request.")
        }
    }

    /// Replaces every Vox reminder notification with the web app's current list,
    /// so completed, deleted, or rescheduled reminders do not fire.
    private static func schedule(_ reminders: [ScheduledReminder]) {
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { pending in
            let stale = pending.map(\.identifier).filter { $0.hasPrefix(identifierPrefix) }
            center.removePendingNotificationRequests(withIdentifiers: stale)

            let upcoming = reminders
                .filter { $0.dueAt > Date() }
                .sorted { $0.dueAt < $1.dueAt }
                .prefix(maximumScheduled)
            for reminder in upcoming {
                let content = UNMutableNotificationContent()
                content.title = "Vox reminder"
                content.body = reminder.notes.map { "\(reminder.title)\n\($0)" } ?? reminder.title
                content.sound = .default
                let components = Calendar.current.dateComponents(
                    [.year, .month, .day, .hour, .minute, .second],
                    from: reminder.dueAt
                )
                let request = UNNotificationRequest(
                    identifier: identifierPrefix + reminder.id,
                    content: content,
                    trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
                )
                center.add(request)
            }
        }
    }

    private static func jsLiteral(_ value: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: .fragmentsAllowed),
              let literal = String(data: data, encoding: .utf8) else {
            return "null"
        }
        return literal
            .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
            .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
    }
}

private struct ScheduledReminder {
    let id: String
    let title: String
    let notes: String?
    let dueAt: Date

    init?(_ object: [String: Any]) {
        guard let id = object["id"] as? String,
              id.range(of: #"^[A-Za-z0-9-]{8,64}$"#, options: .regularExpression) != nil,
              let title = (object["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !title.isEmpty,
              let dueText = object["dueAt"] as? String,
              let dueAt = ScheduledReminder.parseDate(dueText) else {
            return nil
        }
        self.id = id
        self.title = String(title.prefix(180))
        let notes = (object["notes"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.notes = notes?.isEmpty == false ? String(notes!.prefix(300)) : nil
        self.dueAt = dueAt
    }

    private static func parseDate(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}

/// Shows Vox reminder banners even while the app is in the foreground.
final class ReminderNotificationPresenter: NSObject, UNUserNotificationCenterDelegate {
    static let shared = ReminderNotificationPresenter()

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }
}
