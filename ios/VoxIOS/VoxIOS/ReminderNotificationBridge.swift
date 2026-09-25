import Foundation
import UIKit
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
    static let permissionEvent = "voxnativealertpermission"

    weak var webView: WKWebView?
    private var activeObserver: NSObjectProtocol?

    override init() {
        super.init()
        // Tell the page the current permission whenever the app returns to the
        // foreground, since the user may have changed it in Settings.
        activeObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.publishPermission()
        }
    }

    deinit {
        if let activeObserver { NotificationCenter.default.removeObserver(activeObserver) }
    }

    static func currentPermission(_ completion: @escaping (String) -> Void) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let permission: String
            switch settings.authorizationStatus {
            case .authorized, .ephemeral: permission = "granted"
            // Provisional delivery is silent (Notification Center only), so the
            // page still offers to request full banner-and-sound alerts.
            case .provisional: permission = "provisional"
            case .denied: permission = "denied"
            default: permission = "prompt"
            }
            DispatchQueue.main.async { completion(permission) }
        }
    }

    private func publishPermission() {
        Self.currentPermission { [weak self] permission in
            guard let webView = self?.webView,
                  webView.url?.host == AppConfiguration.trustedHost else { return }
            webView.evaluateJavaScript(
                "window.dispatchEvent(new CustomEvent(\(Self.jsLiteral(Self.permissionEvent)), { detail: \(Self.jsLiteral(permission)) }))"
            )
        }
    }

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
              getPermission: () => handler.postMessage({ type: "getPermission" }),
              requestPermission: () => handler.postMessage({ type: "requestPermission" }),
              sync: (reminders) => handler.postMessage({ type: "sync", reminders }),
              syncLocations: (reminders) => handler.postMessage({ type: "syncLocations", reminders }),
              locationPermission: () => handler.postMessage({ type: "locationPermission" }),
              places: () => handler.postMessage({ type: "places" }),
              savePlace: (name) => handler.postMessage({ type: "savePlace", name: String(name) }),
              pickPlace: (name) => handler.postMessage({ type: "pickPlace", name: String(name ?? "") }),
              deletePlace: (name) => handler.postMessage({ type: "deletePlace", name: String(name) }),
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
        case "getPermission":
            Self.currentPermission { replyHandler($0, nil) }
        case "requestPermission":
            // Reply with the resulting state rather than the prompt's yes/no, so
            // quiet (provisional) delivery is reported accurately.
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in
                Self.currentPermission { replyHandler($0, nil) }
            }
        case "sync":
            let reminders = (body["reminders"] as? [[String: Any]] ?? []).compactMap(ScheduledReminder.init)
            Self.schedule(reminders)
            replyHandler(reminders.count, nil)
        case "syncLocations":
            let reminders = (body["reminders"] as? [[String: Any]] ?? [])
                .prefix(40)
                .compactMap(LocationReminderScheduler.LocationReminder.init)
            Task { @MainActor in
                replyHandler(await LocationReminderScheduler.shared.schedule(Array(reminders)), nil)
            }
        case "locationPermission":
            Task { @MainActor in replyHandler(LocationReminderScheduler.shared.permission, nil) }
        case "places":
            Task { @MainActor in replyHandler(LocationReminderScheduler.shared.placeNames(), nil) }
        case "savePlace":
            let name = body["name"] as? String ?? ""
            Task { @MainActor in
                replyHandler(await LocationReminderScheduler.shared.saveCurrentLocation(as: name), nil)
            }
        case "pickPlace":
            let name = body["name"] as? String ?? ""
            Task { @MainActor in
                guard let presenter = self.webView?.window?.rootViewController?.topmostPresented else {
                    replyHandler(["ok": false, "error": "The map couldn’t open right now."], nil)
                    return
                }
                replyHandler(await LocationReminderScheduler.shared.pickPlace(named: name, from: presenter), nil)
            }
        case "deletePlace":
            let name = body["name"] as? String ?? ""
            Task { @MainActor in replyHandler(LocationReminderScheduler.shared.deletePlace(named: name), nil) }
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
                content.categoryIdentifier = ReminderNotificationPresenter.categoryIdentifier
                content.userInfo = ["reminderId": reminder.id]
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

/// Shows Vox reminder banners even while the app is in the foreground, and
/// handles the "Mark as done" action from the lock screen.
final class ReminderNotificationPresenter: NSObject, UNUserNotificationCenterDelegate {
    static let shared = ReminderNotificationPresenter()
    static let categoryIdentifier = "VOX_REMINDER"
    private static let doneAction = "VOX_REMINDER_DONE"

    func register() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.setNotificationCategories([
            UNNotificationCategory(
                identifier: Self.categoryIdentifier,
                actions: [UNNotificationAction(identifier: Self.doneAction, title: "Mark as done", options: [])],
                intentIdentifiers: [],
                options: []
            ),
        ])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        guard response.actionIdentifier == Self.doneAction,
              let reminderId = response.notification.request.content.userInfo["reminderId"] as? String,
              reminderId.range(of: #"^[A-Za-z0-9-]{8,64}$"#, options: .regularExpression) != nil else {
            completionHandler()
            return
        }
        Task { @MainActor in
            await LocationReminderScheduler.shared.cancel(reminderId: reminderId)
            await Self.completeReminder(reminderId)
            completionHandler()
        }
    }

    /// Marks the reminder done using the signed-in session the web app stored.
    @MainActor
    private static func completeReminder(_ reminderId: String) async {
        guard let url = URL(string: "/api/reminders", relativeTo: AppConfiguration.voxURL) else { return }
        let cookies = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
            .filter { AppConfiguration.trustedHost.hasSuffix($0.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))) }
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        for (field, value) in HTTPCookie.requestHeaderFields(with: cookies) {
            request.setValue(value, forHTTPHeaderField: field)
        }
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["id": reminderId, "status": "completed"])
        _ = try? await URLSession.shared.data(for: request)
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }
}
