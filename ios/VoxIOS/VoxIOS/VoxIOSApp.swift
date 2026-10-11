import BackgroundTasks
import SwiftUI
import UIKit
import UserNotifications
@preconcurrency import WebKit

/// Notifications from Vox while the app is closed. Apple's push service is
/// not available to this app's developer account, so the app collects them
/// itself: iOS wakes it in the background from time to time (and whenever it
/// relaunches it for a place or the Mac coming in range), it asks the Vox
/// server what it set out to tell the signed-in account, and shows each as a
/// notification. iOS decides how often that happens, so they can arrive late.
enum NoticeFetcher {
    static let taskIdentifier = "com.ericcheng.vox.notices"
    private static let deviceKey = "vox.noticeDevice"
    private static let cursorKey = "vox.noticeCursor"
    private static let shownKey = "vox.noticeShown"

    /// An id this install made up, so the server can tell devices apart.
    static var deviceId: String {
        if let saved = UserDefaults.standard.string(forKey: deviceKey), saved.count == 64 { return saved }
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let id = bytes.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(id, forKey: deviceKey)
        return id
    }

    static var platform: String { UIDevice.current.userInterfaceIdiom == .pad ? "ipados" : "ios" }

    /// Must run before the app finishes launching.
    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: taskIdentifier, using: nil) { task in
            scheduleNext()
            let work = Task { @MainActor in
                await collect()
                task.setTaskCompleted(success: true)
            }
            task.expirationHandler = { work.cancel() }
        }
    }

    static func scheduleNext() {
        let request = BGAppRefreshTaskRequest(identifier: taskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    /// Asks the server for notices this device has not shown, and shows them.
    @MainActor
    static func collect() async {
        var components = URLComponents(url: AppConfiguration.voxURL.appendingPathComponent("api/push/pending"), resolvingAgainstBaseURL: false)
        var query = [URLQueryItem(name: "device", value: deviceId), URLQueryItem(name: "platform", value: platform)]
        if let cursor = UserDefaults.standard.string(forKey: cursorKey) { query.append(URLQueryItem(name: "since", value: cursor)) }
        components?.queryItems = query
        guard let url = components?.url else { return }
        // The signed-in session the web app stored; without one there is nothing to collect.
        let cookies = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
            .filter { AppConfiguration.trustedHost.hasSuffix($0.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))) }
        guard !cookies.isEmpty else { return }
        var request = URLRequest(url: url, timeoutInterval: 20)
        for (field, value) in HTTPCookie.requestHeaderFields(with: cookies) {
            request.setValue(value, forHTTPHeaderField: field)
        }
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let notices = payload["notices"] as? [[String: Any]] else { return }

        var shown = UserDefaults.standard.stringArray(forKey: shownKey) ?? []
        for notice in notices.prefix(6) {
            guard let id = notice["id"] as? String,
                  id.range(of: #"^[A-Za-z0-9-]{8,64}$"#, options: .regularExpression) != nil,
                  !shown.contains(id),
                  let body = notice["body"] as? String, !body.isEmpty else { continue }
            let content = UNMutableNotificationContent()
            content.title = String((notice["title"] as? String ?? "Vox").prefix(120))
            content.body = String(body.prefix(1_800))
            content.sound = .default
            content.threadIdentifier = "vox"
            try? await UNUserNotificationCenter.current().add(
                UNNotificationRequest(identifier: "vox-notice-\(id)", content: content, trigger: nil)
            )
            shown.append(id)
            if let createdAt = notice["createdAt"] as? String { UserDefaults.standard.set(createdAt, forKey: cursorKey) }
        }
        UserDefaults.standard.set(Array(shown.suffix(40)), forKey: shownKey)
    }
}

final class VoxAppDelegate: NSObject, UIApplicationDelegate {
    private var backgroundObserver: NSObjectProtocol?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        NoticeFetcher.register()
        NoticeFetcher.scheduleNext()
        backgroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { _ in NoticeFetcher.scheduleNext() }
        // Every launch is a chance to collect, including the ones iOS makes
        // in the background for a watched place or the Mac coming in range.
        Task { @MainActor in await NoticeFetcher.collect() }
        return true
    }
}

@main
struct VoxIOSApp: App {
    @UIApplicationDelegateAdaptor(VoxAppDelegate.self) private var appDelegate

    init() {
        ReminderNotificationPresenter.shared.register()
        // When iOS relaunches Vox in the background because you reached or
        // left a watched place, the location manager must exist to hear it.
        _ = LocationReminderScheduler.shared
        // Same for opt-in location sharing: when iOS relaunches Vox in the
        // background for a significant location change, the pinger resumes
        // from its Keychain state, with no web view.
        LocationSharing.resumeAtLaunch()
        // Resumes the "welcome home" Bluetooth watch, including when iOS
        // relaunches Vox in the background because the Mac came in range.
        ProximityGreeter.shared.start()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
        }
    }
}

