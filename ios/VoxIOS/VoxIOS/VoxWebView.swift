import SwiftUI
import UIKit
@preconcurrency import WebKit

struct VoxWebView: UIViewRepresentable {
    let url: URL
    /// Set once the page has something of its own to show (see ContentView).
    @Binding var pageReady: Bool

    /// The page posts to this when its first screen is up.
    static let readyHandlerName = "voxReady"

    func makeCoordinator() -> Coordinator {
        Coordinator(pageReady: $pageReady)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []

        let contentController = WKUserContentController()
        Self.installUserScripts(on: contentController)
        contentController.add(context.coordinator.pairingBridge, name: PairingBridge.handlerName)
        contentController.addScriptMessageHandler(
            context.coordinator.reminderBridge,
            contentWorld: .page,
            name: ReminderNotificationBridge.handlerName
        )
        contentController.addScriptMessageHandler(
            context.coordinator.locationSharingBridge,
            contentWorld: .page,
            name: LocationSharingBridge.handlerName
        )
        contentController.add(context.coordinator, name: Self.readyHandlerName)
        configuration.userContentController = contentController

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.keyboardDismissMode = .interactive
        webView.isOpaque = false
        // Clear, so the sky behind shows through wherever the page has not drawn yet.
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear

        let refreshControl = UIRefreshControl()
        refreshControl.tintColor = .white
        refreshControl.addTarget(
            context.coordinator,
            action: #selector(Coordinator.refresh(_:)),
            for: .valueChanged
        )
        webView.scrollView.refreshControl = refreshControl
        context.coordinator.webView = webView
        context.coordinator.pairingBridge.webView = webView
        context.coordinator.reminderBridge.webView = webView

        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif

        webView.load(URLRequest(url: url, cachePolicy: .useProtocolCachePolicy))
        return webView
    }

    /// Native bridges exposed to the trusted Vox page. Rebuilt whenever the
    /// saved pairing changes, because that script embeds the pairing.
    static func installUserScripts(on contentController: WKUserContentController) {
        contentController.removeAllUserScripts()
        contentController.addUserScript(PairingBridge.userScript(savedPairing: PairingKeychain.load()))
        contentController.addUserScript(ReminderNotificationBridge.userScript())
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard webView.url == nil else { return }
        webView.load(URLRequest(url: url, cachePolicy: .useProtocolCachePolicy))
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: readyHandlerName)
        webView.configuration.userContentController.removeScriptMessageHandler(forName: PairingBridge.handlerName)
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: ReminderNotificationBridge.handlerName,
            contentWorld: .page
        )
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: LocationSharingBridge.handlerName,
            contentWorld: .page
        )
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler {
        weak var webView: WKWebView?
        let pairingBridge = PairingBridge()
        let reminderBridge = ReminderNotificationBridge()
        let locationSharingBridge = LocationSharingBridge()
        private var downloadDestinations: [ObjectIdentifier: URL] = [:]

        private let pageReady: Binding<Bool>

        init(pageReady: Binding<Bool>) {
            self.pageReady = pageReady
        }

        private func showPage() {
            Task { @MainActor in
                self.pageReady.wrappedValue = true
            }
        }

        /// The page's first screen is up.
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == VoxWebView.readyHandlerName,
                  message.frameInfo.isMainFrame,
                  message.frameInfo.securityOrigin.host == AppConfiguration.trustedHost else { return }
            showPage()
        }

        /// A page that never says it is ready (an older version, an error page)
        /// is still shown: the opening screen must not be a place to get stuck.
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in self?.showPage() }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            showPage()
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            showPage()
        }

        @objc func refresh(_ sender: UIRefreshControl) {
            webView?.reload()
            sender.endRefreshing()
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let destination = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            if destination.host == AppConfiguration.trustedHost, navigationAction.shouldPerformDownload {
                decisionHandler(.download)
                return
            }

            if destination.host == AppConfiguration.trustedHost || destination.scheme == "about" {
                decisionHandler(.allow)
                return
            }

            if navigationAction.navigationType == .linkActivated,
               ["http", "https"].contains(destination.scheme?.lowercased() ?? "") {
                UIApplication.shared.open(destination)
            }
            decisionHandler(.cancel)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationResponse: WKNavigationResponse,
            decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
        ) {
            let disposition = (navigationResponse.response as? HTTPURLResponse)?
                .value(forHTTPHeaderField: "Content-Disposition")?
                .lowercased() ?? ""
            if disposition.hasPrefix("attachment") || !navigationResponse.canShowMIMEType {
                decisionHandler(.download)
            } else {
                decisionHandler(.allow)
            }
        }

        func webView(
            _ webView: WKWebView,
            navigationAction: WKNavigationAction,
            didBecome download: WKDownload
        ) {
            download.delegate = self
        }

        func webView(
            _ webView: WKWebView,
            navigationResponse: WKNavigationResponse,
            didBecome download: WKDownload
        ) {
            download.delegate = self
        }

        func download(
            _ download: WKDownload,
            decideDestinationUsing response: URLResponse,
            suggestedFilename: String,
            completionHandler: @escaping (URL?) -> Void
        ) {
            let folder = FileManager.default.temporaryDirectory
                .appendingPathComponent("VoxDownloads", isDirectory: true)
                .appendingPathComponent(UUID().uuidString, isDirectory: true)
            do {
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            } catch {
                completionHandler(nil)
                return
            }
            let name = (suggestedFilename as NSString).lastPathComponent
            let destination = folder.appendingPathComponent(name.isEmpty ? "Vox download" : name)
            downloadDestinations[ObjectIdentifier(download)] = destination
            completionHandler(destination)
        }

        func downloadDidFinish(_ download: WKDownload) {
            guard let fileURL = downloadDestinations.removeValue(forKey: ObjectIdentifier(download)) else {
                return
            }
            presentShareSheet(for: fileURL)
        }

        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            downloadDestinations.removeValue(forKey: ObjectIdentifier(download))
        }

        private func presentShareSheet(for fileURL: URL) {
            guard let webView, let presenter = webView.window?.rootViewController?.topmostPresented else { return }
            let activity = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
            activity.popoverPresentationController?.sourceView = webView
            activity.popoverPresentationController?.sourceRect = CGRect(
                x: webView.bounds.midX,
                y: webView.bounds.midY,
                width: 1,
                height: 1
            )
            presenter.present(activity, animated: true)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            guard navigationAction.targetFrame == nil,
                  let destination = navigationAction.request.url else {
                return nil
            }

            if destination.host == AppConfiguration.trustedHost {
                webView.load(navigationAction.request)
            } else if ["http", "https"].contains(destination.scheme?.lowercased() ?? "") {
                UIApplication.shared.open(destination)
            }
            return nil
        }

        func webView(
            _ webView: WKWebView,
            requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            type: WKMediaCaptureType,
            decisionHandler: @escaping (WKPermissionDecision) -> Void
        ) {
            decisionHandler(origin.host == AppConfiguration.trustedHost ? .grant : .deny)
        }
    }
}

