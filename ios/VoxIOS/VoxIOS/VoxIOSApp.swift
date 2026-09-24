import SwiftUI
import UserNotifications

@main
struct VoxIOSApp: App {
    init() {
        UNUserNotificationCenter.current().delegate = ReminderNotificationPresenter.shared
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
        }
    }
}

