import AuthenticationServices
import CryptoKit
import Foundation
import Security
import UIKit

enum AppConfig {
    static let siteURL = URL(string: "https://vox-flashcards.ericcheng306.workers.dev")!
    static let callbackScheme = "voxflashcards"
    static let redirectURI = "voxflashcards://oauth/callback"
    static let clientName = "Vox Flash Cards for iPhone"
}

/// Small string store in the Keychain, readable after the first unlock so a
/// background refresh can still reach the tokens.
enum Keychain {
    private static let service = "com.ericcheng.voxflashcards"

    private static func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
    }

    static func get(_ key: String) -> String? {
        var request = query(key)
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func set(_ key: String, _ value: String?) {
        guard let value else {
            SecItemDelete(query(key) as CFDictionary)
            return
        }
        let data = Data(value.utf8)
        if SecItemUpdate(query(key) as CFDictionary, [kSecValueData as String: data] as CFDictionary) == errSecItemNotFound {
            var item = query(key)
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(item as CFDictionary, nil)
        }
    }
}

enum AppError: LocalizedError {
    case offline
    case signedOut
    case server(String)

    var errorDescription: String? {
        switch self {
        case .offline: return "You’re offline."
        case .signedOut: return "Sign in again to sync."
        case .server(let message): return message
        }
    }
}

private struct TokenResponse: Decodable {
    let access_token: String
    let refresh_token: String
    let expires_in: Double
}

private struct OAuthErrorResponse: Decodable {
    let error: String
    let error_description: String?
}

/// Signs in with Vox through the flash-card site's OAuth (PKCE, rotating
/// refresh tokens), the same way any MCP app connects.
@MainActor
final class AuthManager: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    @Published private(set) var isSignedIn = Keychain.get("refreshToken") != nil
    @Published private(set) var isSigningIn = false
    @Published var userName = UserDefaults.standard.string(forKey: "userName") ?? ""

    private var refreshTask: Task<String, Error>?
    private var webSession: ASWebAuthenticationSession?

    // MARK: Sign in

    func signIn() async throws {
        isSigningIn = true
        defer { isSigningIn = false }
        let clientId = try await registeredClientId()
        let verifier = Self.randomString(bytes: 48)
        let challenge = Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
        let state = Self.randomString(bytes: 16)
        var components = URLComponents(url: AppConfig.siteURL.appendingPathComponent("oauth/authorize"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            .init(name: "response_type", value: "code"),
            .init(name: "client_id", value: clientId),
            .init(name: "redirect_uri", value: AppConfig.redirectURI),
            .init(name: "code_challenge", value: challenge),
            .init(name: "code_challenge_method", value: "S256"),
            .init(name: "state", value: state),
        ]
        let callback: URL = try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: components.url!, callbackURLScheme: AppConfig.callbackScheme) { url, error in
                if let url {
                    continuation.resume(returning: url)
                } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    continuation.resume(throwing: CancellationError())
                } else {
                    continuation.resume(throwing: error ?? AppError.server("Sign-in didn’t finish."))
                }
            }
            session.presentationContextProvider = self
            // Share Safari's cookies so an existing Vox sign-in is reused.
            session.prefersEphemeralWebBrowserSession = false
            webSession = session
            session.start()
        }
        webSession = nil
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let value = { (name: String) in items.first { $0.name == name }?.value }
        if value("error") == "access_denied" { throw CancellationError() }
        guard value("state") == state, let code = value("code") else {
            throw AppError.server(value("error_description") ?? "Sign-in didn’t finish. Try again.")
        }
        try await exchange([
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": AppConfig.redirectURI,
            "client_id": clientId,
            "code_verifier": verifier,
        ])
        isSignedIn = true
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes
                .compactMap { ($0 as? UIWindowScene)?.keyWindow }
                .first ?? ASPresentationAnchor()
        }
    }

    func signOut() {
        refreshTask?.cancel()
        refreshTask = nil
        for key in ["accessToken", "refreshToken", "accessExpiry"] { Keychain.set(key, nil) }
        UserDefaults.standard.removeObject(forKey: "userName")
        userName = ""
        isSignedIn = false
    }

    func setUserName(_ name: String) {
        userName = name
        UserDefaults.standard.set(name, forKey: "userName")
    }

    // MARK: Tokens

    /// A current access token, refreshing it when it's about to expire.
    func accessToken(forceRefresh: Bool = false) async throws -> String {
        guard isSignedIn else { throw AppError.signedOut }
        if !forceRefresh,
           let token = Keychain.get("accessToken"),
           let expiry = Keychain.get("accessExpiry").flatMap(Double.init),
           expiry > Date().timeIntervalSince1970 + 60 {
            return token
        }
        if let refreshTask { return try await refreshTask.value }
        let task = Task { () throws -> String in
            guard let refreshToken = Keychain.get("refreshToken"), let clientId = Keychain.get("clientId") else {
                throw AppError.signedOut
            }
            try await self.exchange(["grant_type": "refresh_token", "refresh_token": refreshToken, "client_id": clientId])
            guard let token = Keychain.get("accessToken") else { throw AppError.signedOut }
            return token
        }
        refreshTask = task
        defer { refreshTask = nil }
        do {
            return try await task.value
        } catch AppError.signedOut {
            signOut()
            throw AppError.signedOut
        }
    }

    private func exchange(_ form: [String: String]) async throws {
        var request = URLRequest(url: AppConfig.siteURL.appendingPathComponent("oauth/token"))
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var body = URLComponents()
        body.queryItems = form.map { URLQueryItem(name: $0.key, value: $0.value) }
        request.httpBody = body.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B").data(using: .utf8)
        let (data, response) = try await Self.send(request)
        guard response.statusCode == 200, let tokens = try? JSONDecoder().decode(TokenResponse.self, from: data) else {
            let failure = try? JSONDecoder().decode(OAuthErrorResponse.self, from: data)
            if failure?.error == "invalid_grant" || failure?.error == "invalid_client" { throw AppError.signedOut }
            throw AppError.server(failure?.error_description ?? "Sign-in failed. Try again.")
        }
        Keychain.set("accessToken", tokens.access_token)
        Keychain.set("refreshToken", tokens.refresh_token)
        Keychain.set("accessExpiry", String(Date().timeIntervalSince1970 + tokens.expires_in))
    }

    private func registeredClientId() async throws -> String {
        if let clientId = Keychain.get("clientId") { return clientId }
        var request = URLRequest(url: AppConfig.siteURL.appendingPathComponent("oauth/register"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "client_name": AppConfig.clientName,
            "redirect_uris": [AppConfig.redirectURI],
        ])
        let (data, response) = try await Self.send(request)
        guard response.statusCode == 201,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let clientId = object["client_id"] as? String else {
            throw AppError.server("Couldn’t reach Vox Flash Cards. Try again.")
        }
        Keychain.set("clientId", clientId)
        return clientId
    }

    // MARK: Helpers

    static func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw AppError.server("Unexpected response.") }
            return (data, http)
        } catch let error as URLError {
            throw error.code == .cancelled ? CancellationError() : AppError.offline
        }
    }

    private static func randomString(bytes count: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: count)
        _ = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
        return base64URL(Data(bytes))
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

/// Calls the site's app API with the signed-in user's token.
struct APIClient {
    let auth: AuthManager

    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            if let date = ISO8601.withFraction.date(from: text) ?? ISO8601.plain.date(from: text) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Bad date \(text)"))
        }
        return decoder
    }()

    func get<T: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> T {
        var components = URLComponents(url: AppConfig.siteURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) } }
        return try await send(URLRequest(url: components.url!))
    }

    func post<T: Decodable>(_ path: String, body: Any) async throws -> T {
        var request = URLRequest(url: AppConfig.siteURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await send(request)
    }

    private func send<T: Decodable>(_ base: URLRequest) async throws -> T {
        var request = base
        request.timeoutInterval = 30
        for attempt in 0..<2 {
            let token = try await auth.accessToken(forceRefresh: attempt > 0)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            let (data, response) = try await AuthManager.send(request)
            if response.statusCode == 401 { continue }
            guard (200..<300).contains(response.statusCode) else {
                let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
                throw AppError.server(message ?? "Vox Flash Cards had a problem. Try again.")
            }
            return try Self.decoder.decode(T.self, from: data)
        }
        await MainActor.run { auth.signOut() }
        throw AppError.signedOut
    }
}

enum ISO8601 {
    static let withFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    static let plain = ISO8601DateFormatter()
}
