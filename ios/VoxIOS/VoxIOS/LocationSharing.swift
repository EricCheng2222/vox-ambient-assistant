import CoreLocation
import Foundation
import Security
import UIKit

/// Opt-in location sharing: lets Vox show where this iPhone last was on your
/// map in Vox (web and desktop). This is separate from place reminders, whose
/// locations never leave the phone.
///
/// The web page registers this iPhone as a device with the server and hands
/// the device ID and token to native code, which keeps them in the Keychain.
/// iOS's significant-change service then wakes Vox, even while it's closed if
/// "Always" is allowed, after the iPhone has moved a fair distance, and Vox
/// sends one ping: coordinates, accuracy, a short place name worked out on the
/// device, and the battery level. Because everything needed lives in the
/// Keychain, pings work after a background relaunch with no web view.
/// Coordinates are never logged.
@MainActor
final class LocationSharing: NSObject, CLLocationManagerDelegate {
    static let shared = LocationSharing()

    /// At most one ping per this interval...
    private static let minimumInterval: TimeInterval = 5 * 60
    /// ...unless the iPhone has moved at least this far since the last one.
    private static let minimumDistance: CLLocationDistance = 250
    private static let recentLocationAge: TimeInterval = 60
    private static let locationTimeout: Duration = .seconds(20)
    private static let geocodeTimeout: Duration = .seconds(8)
    private static let requestAttempts = 2
    private static let maximumPlaceLength = 200
    private static let enableReplyWait: Duration = .seconds(10)

    private static var unlockObserver: NSObjectProtocol?

    private let manager = CLLocationManager()
    private var locationWaiters: [(CLLocation?) -> Void] = []
    private var locationRequest = 0
    private var lastPing: Task<Bool, Never>?
    private var activeObserver: NSObjectProtocol?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        activeObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.appDidBecomeActive() }
        }
    }

    // MARK: Launch

    /// Runs at every launch, including when iOS relaunches Vox in the
    /// background for a significant location change. The location manager
    /// must be recreated and monitoring restarted to receive that event, which
    /// iOS then delivers to `locationManager(_:didUpdateLocations:)`.
    static func resumeAtLaunch() {
        switch LocationSharingKeychain.load() {
        case .found:
            shared.startMonitoringIfAuthorized()
        case .locked:
            // Relaunched after a restart, before the first unlock: the Keychain
            // can't be read yet, so resume once it can.
            guard unlockObserver == nil else { return }
            unlockObserver = NotificationCenter.default.addObserver(
                forName: UIApplication.protectedDataDidBecomeAvailableNotification,
                object: nil,
                queue: .main
            ) { _ in
                Task { @MainActor in
                    if let observer = unlockObserver { NotificationCenter.default.removeObserver(observer) }
                    unlockObserver = nil
                    resumeAtLaunch()
                }
            }
        case .missing:
            break
        }
    }

    // MARK: Bridge API

    var permission: String {
        switch manager.authorizationStatus {
        case .authorizedAlways: return "always"
        case .authorizedWhenInUse: return "whenInUse"
        case .denied, .restricted: return "denied"
        default: return "prompt"
        }
    }

    private var isAuthorized: Bool {
        [.authorizedAlways, .authorizedWhenInUse].contains(manager.authorizationStatus)
    }

    /// `enabled` means sharing is turned on (this iPhone holds a device token);
    /// `permission` says whether iOS lets Vox actually read the location.
    func status() -> [String: Any] {
        let state = LocationSharingKeychain.load().state
        return [
            "enabled": state != nil,
            "permission": permission,
            "deviceId": state?.deviceId ?? NSNull(),
            "lastPingAt": state?.lastPingAt.map(Self.timestamp) ?? NSNull(),
        ]
    }

    func enable(deviceId: String, token: String) async throws -> [String: Any] {
        guard Self.isAllowed(deviceId, length: 8...64), Self.isAllowed(token, length: 32...128) else {
            throw LocationSharingError.invalidCredentials
        }
        guard LocationSharingKeychain.save(LocationSharingState(deviceId: deviceId, token: token)) else {
            throw LocationSharingError.keychainUnavailable
        }
        // Shares the reminders' permission flow, so iOS's one-time "Always"
        // upgrade prompt is asked for at most once by either feature. With
        // only "While Using", sharing still works while Vox is open.
        let permissions = LocationReminderScheduler.shared
        if await permissions.requestPermission() == "granted" {
            _ = await permissions.requestAlwaysPermission()
        }
        startMonitoringIfAuthorized()
        // Send the first ping now, and include its time in the reply if it
        // lands quickly; otherwise it finishes on its own.
        let first = ping(force: true)
        await Self.waitBriefly(for: first, upTo: Self.enableReplyWait)
        return status()
    }

    func disable() -> [String: Any] {
        stopSharing()
        return status()
    }

    /// Pings right away regardless of the throttle; true if the server took it.
    func pingNow() async -> Bool {
        await ping(force: true).value
    }

    private func stopSharing() {
        manager.stopMonitoringSignificantLocationChanges()
        LocationSharingKeychain.delete()
        finishLocationRequest(nil)
    }

    private func startMonitoringIfAuthorized() {
        guard isAuthorized, CLLocationManager.significantLocationChangeMonitoringAvailable() else { return }
        manager.startMonitoringSignificantLocationChanges()
    }

    private func appDidBecomeActive() {
        guard LocationSharingKeychain.load().state != nil else { return }
        // Picks up permission the user may have just granted in Settings.
        startMonitoringIfAuthorized()
        if isAuthorized { ping(force: false) }
    }

    // MARK: Location

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            guard LocationSharingKeychain.load().state != nil else { return }
            self.startMonitoringIfAuthorized()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        Task { @MainActor in
            if self.locationWaiters.isEmpty {
                // A significant-change event, possibly with no UI after iOS
                // relaunched Vox in the background.
                self.ping(force: false, at: location)
            } else {
                self.finishLocationRequest(location)
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in self.finishLocationRequest(nil) }
    }

    private func currentLocation() async -> CLLocation? {
        if let recent = manager.location,
           recent.horizontalAccuracy >= 0,
           -recent.timestamp.timeIntervalSinceNow < Self.recentLocationAge {
            return recent
        }
        return await withCheckedContinuation { continuation in
            locationWaiters.append { continuation.resume(returning: $0) }
            guard locationWaiters.count == 1 else { return }
            locationRequest += 1
            let request = locationRequest
            manager.requestLocation()
            Task { @MainActor in
                try? await Task.sleep(for: Self.locationTimeout)
                if self.locationRequest == request { self.finishLocationRequest(nil) }
            }
        }
    }

    private func finishLocationRequest(_ location: CLLocation?) {
        locationRequest += 1
        let waiters = locationWaiters
        locationWaiters.removeAll()
        waiters.forEach { $0(location) }
    }

    // MARK: Pinging

    /// Pings run one at a time, so each sees the previous one's result when
    /// deciding whether it's worth sending.
    @discardableResult
    private func ping(force: Bool, at location: CLLocation? = nil) -> Task<Bool, Never> {
        let previous = lastPing
        let task = Task { @MainActor () -> Bool in
            _ = await previous?.value
            return await self.sendPing(force: force, at: location)
        }
        lastPing = task
        return task
    }

    private func sendPing(force: Bool, at provided: CLLocation?) async -> Bool {
        guard let state = LocationSharingKeychain.load().state, isAuthorized else { return false }
        let background = BackgroundActivity(name: "Vox location sharing")
        defer { background.end() }

        var location = provided
        if location == nil { location = await currentLocation() }
        guard let location,
              location.horizontalAccuracy >= 0,
              CLLocationCoordinate2DIsValid(location.coordinate) else { return false }
        if !force, !Self.worthSending(location, after: state) { return false }

        let body: [String: Any] = [
            "lat": location.coordinate.latitude,
            "lon": location.coordinate.longitude,
            "accuracy": location.horizontalAccuracy,
            "capturedAt": Self.timestamp(location.timestamp),
            "place": await Self.placeName(for: location) ?? NSNull(),
            "battery": Self.batteryLevel() ?? NSNull(),
        ]

        // Sharing may have been turned off, or switched to a new device,
        // while the place name was being looked up.
        guard let current = LocationSharingKeychain.load().state,
              current.deviceId == state.deviceId,
              current.token == state.token else { return false }

        switch await Self.deliver(body, token: current.token) {
        case .sent:
            if var latest = LocationSharingKeychain.load().state, latest.token == current.token {
                latest.lastPingAt = Date()
                latest.lastLatitude = location.coordinate.latitude
                latest.lastLongitude = location.coordinate.longitude
                LocationSharingKeychain.save(latest)
            }
            return true
        case .revoked:
            // The token was revoked (say, the device was removed in Vox): stop
            // for good until the page turns sharing on again.
            if LocationSharingKeychain.load().state?.token == current.token { stopSharing() }
            return false
        case .failed:
            return false
        }
    }

    private static func worthSending(_ location: CLLocation, after state: LocationSharingState) -> Bool {
        guard let lastAt = state.lastPingAt,
              let latitude = state.lastLatitude,
              let longitude = state.lastLongitude else { return true }
        if Date().timeIntervalSince(lastAt) >= minimumInterval { return true }
        return location.distance(from: CLLocation(latitude: latitude, longitude: longitude)) > minimumDistance
    }

    private enum Delivery { case sent, revoked, failed }

    private static func deliver(_ body: [String: Any], token: String) async -> Delivery {
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return .failed }
        var request = URLRequest(url: AppConfiguration.voxURL.appendingPathComponent("api/locations/ping"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        request.httpShouldHandleCookies = false
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 15
        // Retry once if the network (or the server) failed.
        for attempt in 1...requestAttempts {
            if let (_, response) = try? await URLSession.shared.data(for: request),
               let status = (response as? HTTPURLResponse)?.statusCode {
                if (200..<300).contains(status) { return .sent }
                if status == 401 { return .revoked }
                if status < 500 { return .failed }
            }
            if attempt < requestAttempts { try? await Task.sleep(for: .seconds(3)) }
        }
        return .failed
    }

    // MARK: Details

    /// A short place name such as "十全一路, Sanmin District, Kaohsiung" or
    /// "Apple Park, Cupertino", reverse-geocoded in the device's language.
    private static func placeName(for location: CLLocation) async -> String? {
        let geocoder = CLGeocoder()
        let timeout = Task { @MainActor in
            guard (try? await Task.sleep(for: geocodeTimeout)) != nil else { return }
            geocoder.cancelGeocode()
        }
        defer { timeout.cancel() }
        guard let placemark = try? await geocoder.reverseGeocodeLocation(location, preferredLocale: .current).first else {
            return nil
        }
        return describe(placemark)
    }

    private static func describe(_ placemark: CLPlacemark) -> String? {
        var parts: [String] = []
        func add(_ value: String?) {
            guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty,
                  !parts.contains(where: { $0.localizedCaseInsensitiveCompare(value) == .orderedSame }) else { return }
            parts.append(value)
        }
        if let landmark = placemark.areasOfInterest?.first {
            add(landmark)
        } else {
            add(placemark.thoroughfare)
            add(placemark.subLocality)
        }
        add(placemark.locality ?? placemark.administrativeArea)
        if parts.isEmpty { add(placemark.name ?? placemark.inlandWater ?? placemark.ocean) }
        guard !parts.isEmpty else { return nil }
        // The server counts length the way JavaScript does, in UTF-16 units.
        var text = ""
        for character in parts.joined(separator: ", ") {
            guard text.utf16.count + String(character).utf16.count <= maximumPlaceLength else { break }
            text.append(character)
        }
        return text
    }

    private static func batteryLevel() -> Double? {
        let device = UIDevice.current
        if !device.isBatteryMonitoringEnabled { device.isBatteryMonitoringEnabled = true }
        let level = device.batteryLevel
        return level >= 0 ? (Double(level) * 100).rounded() / 100 : nil
    }

    private static func timestamp(_ date: Date) -> String {
        ISO8601DateFormatter().string(from: date)
    }

    private static func isAllowed(_ value: String, length: ClosedRange<Int>) -> Bool {
        length.contains(value.utf8.count) && value.utf8.allSatisfy { byte in
            (0x30...0x39).contains(byte) || (0x41...0x5A).contains(byte) || (0x61...0x7A).contains(byte)
                || byte == 0x5F || byte == 0x2D
        }
    }

    /// Waits for `task`, but no longer than `limit`.
    private static func waitBriefly(for task: Task<Bool, Never>, upTo limit: Duration) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            var resumed = false
            let resume = {
                guard !resumed else { return }
                resumed = true
                continuation.resume()
            }
            Task { @MainActor in
                _ = await task.value
                resume()
            }
            Task { @MainActor in
                try? await Task.sleep(for: limit)
                resume()
            }
        }
    }
}

enum LocationSharingError: LocalizedError {
    case invalidCredentials
    case keychainUnavailable

    var errorDescription: String? {
        switch self {
        case .invalidCredentials: return "Invalid device ID or token."
        case .keychainUnavailable: return "This iPhone couldn’t save the sharing key securely. Try again."
        }
    }
}

/// Keeps the app running briefly in the background while a ping is sent.
@MainActor
private final class BackgroundActivity {
    private var identifier = UIBackgroundTaskIdentifier.invalid

    init(name: String) {
        identifier = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in
            self?.end()
        }
    }

    func end() {
        guard identifier != .invalid else { return }
        UIApplication.shared.endBackgroundTask(identifier)
        identifier = .invalid
    }
}

/// What location sharing keeps on this iPhone: the device credentials from the
/// server, and where and when the last ping was sent (for throttling).
struct LocationSharingState: Codable {
    let deviceId: String
    let token: String
    var lastPingAt: Date?
    var lastLatitude: Double?
    var lastLongitude: Double?
}

/// Location sharing state, kept only in this iPhone's Keychain.
enum LocationSharingKeychain {
    private static let service = "com.ericcheng.vox.location-sharing"
    private static let account = "this-iphone"

    enum Loaded {
        case found(LocationSharingState)
        case missing
        /// The iPhone restarted and hasn't been unlocked yet.
        case locked

        var state: LocationSharingState? {
            if case .found(let state) = self { return state }
            return nil
        }
    }

    private static var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    static func load() -> Loaded {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        switch SecItemCopyMatching(query as CFDictionary, &result) {
        case errSecSuccess:
            guard let data = result as? Data,
                  let state = try? JSONDecoder().decode(LocationSharingState.self, from: data) else {
                return .missing
            }
            return .found(state)
        case errSecInteractionNotAllowed:
            return .locked
        default:
            return .missing
        }
    }

    @discardableResult
    static func save(_ state: LocationSharingState) -> Bool {
        guard let data = try? JSONEncoder().encode(state) else { return false }
        var status = SecItemUpdate(baseQuery as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = baseQuery
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(item as CFDictionary, nil)
        }
        return status == errSecSuccess
    }

    static func delete() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}
