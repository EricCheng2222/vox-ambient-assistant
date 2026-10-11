import Network
import SwiftUI

struct ContentView: View {
    @StateObject private var connectivity = ConnectivityMonitor()
    /// The page has something of its own to show. Until then the opening
    /// screen stays up, so nothing about starting Vox looks like a web page loading.
    @State private var pageReady = false

    var body: some View {
        ZStack(alignment: .top) {
            VoxSky()
                .ignoresSafeArea()

            VoxWebView(
                url: AppConfiguration.voxURL,
                pageReady: $pageReady
            )
            .ignoresSafeArea(.container, edges: .bottom)
            .opacity(pageReady ? 1 : 0)

            if !pageReady {
                VoxOpening()
                    .ignoresSafeArea()
                    .transition(.opacity)
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
        .animation(.easeOut(duration: 0.35), value: pageReady)
    }
}

/// Vox's evening sky: night overhead, the last light along the bottom. The
/// same colours as the page's Sunset look (app/sunrise.css).
struct VoxSky: View {
    var body: some View {
        LinearGradient(
            stops: [
                .init(color: Color(red: 0.082, green: 0.075, blue: 0.180), location: 0),
                .init(color: Color(red: 0.137, green: 0.106, blue: 0.282), location: 0.26),
                .init(color: Color(red: 0.263, green: 0.153, blue: 0.365), location: 0.50),
                .init(color: Color(red: 0.486, green: 0.208, blue: 0.384), location: 0.70),
                .init(color: Color(red: 0.741, green: 0.310, blue: 0.361), location: 0.85),
                .init(color: Color(red: 0.914, green: 0.522, blue: 0.337), location: 0.95),
                .init(color: Color(red: 0.965, green: 0.678, blue: 0.400), location: 1),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }
}

/// The opening screen: a sun breathing on the sky, with rings drifting off it.
/// The page draws the same thing while it checks who is there (.vox-opening).
struct VoxOpening: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var breathing = false
    @State private var ringing = false

    private let sun = LinearGradient(
        stops: [
            .init(color: Color(red: 1.0, green: 0.878, blue: 0.741), location: 0),
            .init(color: Color(red: 0.961, green: 0.635, blue: 0.353), location: 0.55),
            .init(color: Color(red: 0.886, green: 0.341, blue: 0.298), location: 1),
        ],
        startPoint: .top,
        endPoint: .bottom
    )

    var body: some View {
        ZStack {
            VoxSky()
            if !reduceMotion {
                ForEach(0..<2, id: \.self) { index in
                    Circle()
                        .stroke(Color(red: 1.0, green: 0.84, blue: 0.67).opacity(0.55), lineWidth: 1)
                        .frame(width: 88, height: 88)
                        .scaleEffect(ringing ? 2.3 : 1)
                        .opacity(ringing ? 0 : 0.7)
                        .animation(.easeOut(duration: 2.6).repeatForever(autoreverses: false).delay(Double(index) * 1.3), value: ringing)
                }
            }
            Circle()
                .fill(sun)
                .frame(width: 88, height: 88)
                .shadow(color: Color(red: 0.961, green: 0.635, blue: 0.353).opacity(0.55), radius: 28)
                .scaleEffect(reduceMotion ? 1 : (breathing ? 1.04 : 0.94))
                .animation(reduceMotion ? nil : .easeInOut(duration: 1.3).repeatForever(autoreverses: true), value: breathing)
        }
        .accessibilityElement()
        .accessibilityLabel("Opening Vox")
        .onAppear {
            breathing = true
            ringing = true
        }
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
