import SwiftUI

@main
struct VoxFlashCardsApp: App {
    @StateObject private var auth: AuthManager
    @StateObject private var library: Library

    init() {
        let auth = AuthManager()
        _auth = StateObject(wrappedValue: auth)
        _library = StateObject(wrappedValue: Library(auth: auth))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(auth)
                .environmentObject(library)
        }
    }
}
