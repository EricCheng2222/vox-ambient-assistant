import SwiftUI
import UserNotifications

@main
struct VoxIOSApp: App {
    init() {
        ReminderNotificationPresenter.shared.register()
        // When iOS relaunches Vox in the background because you reached or
        // left a watched place, the location manager must exist to hear it.
        _ = LocationReminderScheduler.shared
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
        }
    }
}

