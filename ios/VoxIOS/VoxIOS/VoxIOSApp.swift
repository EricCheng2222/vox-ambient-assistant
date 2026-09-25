import SwiftUI
import UserNotifications

@main
struct VoxIOSApp: App {
    init() {
        ReminderNotificationPresenter.shared.register()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
        }
    }
}

