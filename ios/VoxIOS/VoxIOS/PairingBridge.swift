import AVFoundation
import Security
import UIKit
@preconcurrency import WebKit

/// Connects the Vox web app to native iOS features needed for Mac pairing:
/// a QR scanner for the Mac's pairing code, and Keychain storage so the
/// pairing survives app restarts (the web app keeps it in sessionStorage only).
final class PairingBridge: NSObject, WKScriptMessageHandler {
    static let handlerName = "voxNative"
    static let storageKey = "vox.remoteMac.pairing.v1"

    weak var webView: WKWebView?

    static func userScript(savedPairing: String?) -> WKUserScript {
        let host = jsLiteral(AppConfiguration.trustedHost)
        let saved = savedPairing.map(jsLiteral) ?? "null"
        let key = jsLiteral(storageKey)
        let source = """
        (() => {
          if (location.protocol !== "https:" || location.host !== \(host)) return;
          const handler = window.webkit?.messageHandlers?.\(handlerName);
          if (!handler) return;
          const KEY = \(key);
          Object.defineProperty(window, "voxNativeIOS", {
            value: Object.freeze({
              canScanPairing: true,
              scanPairing: () => handler.postMessage({ type: "scanPairing" }),
            }),
          });
          const store = window.sessionStorage;
          const saved = \(saved);
          try {
            if (saved && !store.getItem(KEY)) store.setItem(KEY, saved);
          } catch {}
          const setItem = Storage.prototype.setItem;
          const removeItem = Storage.prototype.removeItem;
          Storage.prototype.setItem = function (name, value) {
            setItem.call(this, name, value);
            if (this === store && name === KEY) handler.postMessage({ type: "pairing", value: String(value) });
          };
          Storage.prototype.removeItem = function (name) {
            removeItem.call(this, name);
            if (this === store && name === KEY) handler.postMessage({ type: "pairing", value: null });
          };
        })();
        """
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame,
              origin.protocol == "https",
              origin.host == AppConfiguration.trustedHost,
              let body = message.body as? [String: Any],
              let type = body["type"] as? String else {
            return
        }

        switch type {
        case "pairing":
            if let value = body["value"] as? String, PairingBridge.isValidStoredPairing(value) {
                PairingKeychain.save(value)
            } else if body["value"] is NSNull {
                PairingKeychain.delete()
            } else {
                return
            }
            VoxWebView.installUserScripts(on: userContentController)
        case "scanPairing":
            presentScanner()
        default:
            break
        }
    }

    private func presentScanner() {
        guard let webView, let presenter = webView.window?.rootViewController?.topmostPresented else { return }
        let scanner = PairingScannerViewController { [weak self] url in
            self?.webView?.load(URLRequest(url: url))
        }
        scanner.modalPresentationStyle = .fullScreen
        presenter.present(scanner, animated: true)
    }

    static func isValidStoredPairing(_ value: String) -> Bool {
        guard let data = value.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let deviceId = object["deviceId"] as? String,
              let secret = object["secret"] as? String,
              object["name"] is String else {
            return false
        }
        return matches(deviceId, #"^[a-f0-9-]{36}$"#) && matches(secret, #"^[A-Za-z0-9_-]{40,64}$"#)
    }

    /// Accepts only a Vox pairing link for the configured backend.
    static func pairingURL(from text: String) -> URL? {
        guard let components = URLComponents(string: text),
              components.scheme == "https",
              components.host == AppConfiguration.trustedHost,
              let deviceId = components.queryItems?.first(where: { $0.name == "pair" })?.value,
              matches(deviceId, #"^[a-f0-9-]{36}$"#),
              let fragment = components.fragment else {
            return nil
        }
        var hash = URLComponents()
        hash.query = fragment
        guard let secret = hash.queryItems?.first(where: { $0.name == "vox-pair" })?.value,
              matches(secret, #"^[A-Za-z0-9_-]{40,64}$"#) else {
            return nil
        }
        return components.url
    }

    private static func matches(_ value: String, _ pattern: String) -> Bool {
        value.range(of: pattern, options: .regularExpression) != nil
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

enum PairingKeychain {
    private static let service = "com.ericcheng.vox.remote-mac-pairing"
    private static let account = "paired-mac"

    private static var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    static func load() -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    static func save(_ value: String) {
        guard load() != value else { return }
        let data = Data(value.utf8)
        let status = SecItemUpdate(baseQuery as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = baseQuery
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(item as CFDictionary, nil)
        }
    }

    static func delete() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}

extension UIViewController {
    var topmostPresented: UIViewController {
        var controller = self
        while let next = controller.presentedViewController {
            controller = next
        }
        return controller
    }
}

final class PairingScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let onPairingLink: (URL) -> Void
    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "com.vox.ios.pairing-scanner")
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private let statusLabel = UILabel()
    private var finished = false

    init(onPairingLink: @escaping (URL) -> Void) {
        self.onPairingLink = onPairingLink
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.015, green: 0.06, blue: 0.08, alpha: 1)

        let title = UILabel()
        title.text = "Pair with your Mac"
        title.font = .preferredFont(forTextStyle: .headline)
        title.textColor = .white

        statusLabel.text = "In Vox Desktop, open the phone pairing panel and point the camera at the QR code."
        statusLabel.font = .preferredFont(forTextStyle: .subheadline)
        statusLabel.textColor = UIColor.white.withAlphaComponent(0.7)
        statusLabel.numberOfLines = 0
        statusLabel.textAlignment = .center

        let close = UIButton(type: .system)
        close.setTitle("Cancel", for: .normal)
        close.titleLabel?.font = .preferredFont(forTextStyle: .body)
        close.tintColor = .white
        close.addTarget(self, action: #selector(cancel), for: .touchUpInside)

        let header = UIStackView(arrangedSubviews: [title, UIView(), close])
        header.axis = .horizontal
        header.alignment = .center

        let footer = UIView()
        footer.backgroundColor = UIColor.black.withAlphaComponent(0.55)
        footer.layer.cornerRadius = 14
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        footer.addSubview(statusLabel)

        [header, footer].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview($0)
        }
        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: guide.topAnchor, constant: 12),
            header.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 20),
            header.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -20),
            footer.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 20),
            footer.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -20),
            footer.bottomAnchor.constraint(equalTo: guide.bottomAnchor, constant: -20),
            statusLabel.topAnchor.constraint(equalTo: footer.topAnchor, constant: 14),
            statusLabel.bottomAnchor.constraint(equalTo: footer.bottomAnchor, constant: -14),
            statusLabel.leadingAnchor.constraint(equalTo: footer.leadingAnchor, constant: 16),
            statusLabel.trailingAnchor.constraint(equalTo: footer.trailingAnchor, constant: -16),
        ])

        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configureSession()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    if granted {
                        self?.configureSession()
                    } else {
                        self?.showProblem("Camera access is off. Allow it for Vox in Settings to scan the pairing code.")
                    }
                }
            }
        default:
            showProblem("Camera access is off. Allow it for Vox in Settings to scan the pairing code.")
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        let session = session
        sessionQueue.async {
            if session.isRunning { session.stopRunning() }
        }
    }

    private func configureSession() {
        guard let camera = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: camera),
              session.canAddInput(input) else {
            showProblem("No camera is available on this device.")
            return
        }
        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else {
            showProblem("The camera could not start.")
            return
        }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]

        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        preview.frame = view.bounds
        view.layer.insertSublayer(preview, at: 0)
        previewLayer = preview

        let session = session
        sessionQueue.async { session.startRunning() }
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard !finished else { return }
        for object in metadataObjects {
            guard let code = object as? AVMetadataMachineReadableCodeObject,
                  let text = code.stringValue else { continue }
            if let url = PairingBridge.pairingURL(from: text) {
                finished = true
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                dismiss(animated: true) { [onPairingLink] in onPairingLink(url) }
                return
            }
            statusLabel.text = "That QR code isn't a Vox pairing code. Use the code shown in Vox Desktop."
        }
    }

    private func showProblem(_ text: String) {
        statusLabel.text = text
    }

    @objc private func cancel() {
        dismiss(animated: true)
    }
}
