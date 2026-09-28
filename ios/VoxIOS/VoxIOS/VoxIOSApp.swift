import SwiftUI
import UserNotifications

@main
struct VoxIOSApp: App {
    init() {
        ReminderNotificationPresenter.shared.register()
        // When iOS relaunches Vox in the background because you reached or
        // left a watched place, the location manager must exist to hear it.
        _ = LocationReminderScheduler.shared
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

