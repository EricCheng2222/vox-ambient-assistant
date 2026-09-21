import Network
import SwiftUI

struct ContentView: View {
    @StateObject private var connectivity = ConnectivityMonitor()
    @State private var loadingProgress = 0.0

    var body: some View {
        ZStack(alignment: .top) {
            Color(red: 0.015, green: 0.06, blue: 0.08)
                .ignoresSafeArea()

            VoxWebView(
                url: AppConfiguration.voxURL,
                loadingProgress: $loadingProgress
            )
            .ignoresSafeArea(.container, edges: .bottom)

            if loadingProgress > 0, loadingProgress < 1 {
                ProgressView(value: loadingProgress)
                    .progressViewStyle(.linear)
                    .tint(Color(red: 0.45, green: 0.9, blue: 1))
            }

            if !connectivity.isConnected {
                Label("Vox is offline", systemImage: "wifi.slash")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(.black.opacity(0.78), in: Capsule())
                    .padding(.top, 10)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.2), value: connectivity.isConnected)
    }
}

@MainActor
private final class ConnectivityMonitor: ObservableObject {
    @Published private(set) var isConnected = true

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "com.vox.ios.connectivity")

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                self?.isConnected = path.status == .satisfied
            }
        }
        monitor.start(queue: queue)
    }

    deinit {
        monitor.cancel()
    }
}

