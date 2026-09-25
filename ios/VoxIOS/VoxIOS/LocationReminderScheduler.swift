import CoreLocation
import Foundation
import MapKit
import Security
import UserNotifications

/// Arms Vox's place-based reminders as iOS location notifications.
///
/// Location stays on this iPhone: saved places live in the Keychain, store
/// names are searched with MapKit on the device, and iOS itself watches the
/// geofences. The server only ever learns whether a reminder was armed.
@MainActor
final class LocationReminderScheduler: NSObject, CLLocationManagerDelegate {
    static let shared = LocationReminderScheduler()
    static let identifierPrefix = "vox-place-"

    /// iOS monitors at most 20 regions per app; leave headroom.
    private static let maximumRegions = 18
    private static let regionRadius: CLLocationDistance = 150
    private static let searchRadius: CLLocationDistance = 30_000
    private static let matchesPerSearch = 3

    private let manager = CLLocationManager()
    private var authorizationWaiters: [(CLAuthorizationStatus) -> Void] = []
    private var locationWaiters: [(CLLocation?) -> Void] = []

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    // MARK: Permission

    var permission: String {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways: return "granted"
        case .denied, .restricted: return "denied"
        default: return "prompt"
        }
    }

    /// Location notifications need only "While Using the App" permission.
    func requestPermission() async -> String {
        if manager.authorizationStatus == .notDetermined {
            _ = await withCheckedContinuation { continuation in
                authorizationWaiters.append { continuation.resume(returning: $0) }
                manager.requestWhenInUseAuthorization()
            }
        }
        return permission
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            guard status != .notDetermined else { return }
            let waiters = self.authorizationWaiters
            self.authorizationWaiters.removeAll()
            waiters.forEach { $0(status) }
        }
    }

    private func currentLocation() async -> CLLocation? {
        guard permission == "granted" else { return nil }
        if let recent = manager.location, recent.timestamp.timeIntervalSinceNow > -120 {
            return recent
        }
        return await withCheckedContinuation { continuation in
            locationWaiters.append { continuation.resume(returning: $0) }
            if locationWaiters.count == 1 { manager.requestLocation() }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let location = locations.last
        Task { @MainActor in self.finishLocationRequest(location) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in self.finishLocationRequest(nil) }
    }

    private func finishLocationRequest(_ location: CLLocation?) {
        let waiters = locationWaiters
        locationWaiters.removeAll()
        waiters.forEach { $0(location) }
    }

    // MARK: Saved places

    func placeNames() -> [String] {
        SavedPlaces.load().map(\.name)
    }

    /// Saves the iPhone's current location under a name such as "Home".
    func saveCurrentLocation(as rawName: String) async -> [String: Any] {
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= 40 else {
            return ["ok": false, "error": "Use a short place name."]
        }
        guard await requestPermission() == "granted" else {
            return ["ok": false, "error": "Allow location for Vox in iPhone Settings."]
        }
        guard let location = await currentLocation() else {
            return ["ok": false, "error": "The iPhone couldn’t determine its location. Try again outdoors or with Wi‑Fi on."]
        }
        var places = SavedPlaces.load().filter { SavedPlaces.key($0.name) != SavedPlaces.key(name) }
        places.append(SavedPlace(
            name: name,
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude
        ))
        guard SavedPlaces.save(Array(places.suffix(20))) else {
            return ["ok": false, "error": "The iPhone couldn’t save this place securely. Try again."]
        }
        return ["ok": true, "places": placeNames()]
    }

    func deletePlace(named name: String) -> [String] {
        _ = SavedPlaces.save(SavedPlaces.load().filter { SavedPlaces.key($0.name) != SavedPlaces.key(name) })
        return placeNames()
    }

    // MARK: Scheduling

    struct LocationReminder {
        let id: String
        let title: String
        let notes: String?
        let place: String
        let leaving: Bool

        init?(_ object: [String: Any]) {
            guard let id = object["id"] as? String,
                  id.range(of: #"^[A-Za-z0-9-]{8,64}$"#, options: .regularExpression) != nil,
                  let title = (object["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !title.isEmpty,
                  let place = (object["place"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !place.isEmpty else {
                return nil
            }
            self.id = id
            self.title = String(title.prefix(180))
            let notes = (object["notes"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            self.notes = notes?.isEmpty == false ? String(notes!.prefix(300)) : nil
            self.place = String(place.prefix(80))
            self.leaving = (object["placeEvent"] as? String) == "leave"
        }
    }

    /// Replaces every armed place notification with the web app's current list
    /// and reports, per reminder, whether it could be armed.
    func schedule(_ reminders: [LocationReminder]) async -> [[String: String]] {
        let notificationCenter = UNUserNotificationCenter.current()
        let pending = await notificationCenter.pendingNotificationRequests()
        notificationCenter.removePendingNotificationRequests(
            withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix(Self.identifierPrefix) }
        )
        guard !reminders.isEmpty else { return [] }

        guard await requestPermission() == "granted" else {
            return reminders.map { ["id": $0.id, "status": "permission_needed"] }
        }
        // iOS refuses to schedule notifications until the user allows them.
        let alerts = await notificationCenter.notificationSettings().authorizationStatus
        guard [.authorized, .provisional, .ephemeral].contains(alerts) else {
            return reminders.map { ["id": $0.id, "status": "notifications_off"] }
        }

        var remaining = Self.maximumRegions
        var statuses: [[String: String]] = []
        for reminder in reminders {
            let centers = await coordinates(for: reminder.place)
            guard !centers.isEmpty else {
                statuses.append(["id": reminder.id, "status": "place_not_found"])
                continue
            }
            guard remaining >= 1 else {
                statuses.append(["id": reminder.id, "status": "limit_reached"])
                continue
            }
            var armed = 0
            for (index, center) in centers.prefix(remaining).enumerated() {
                let identifier = "\(Self.identifierPrefix)\(reminder.id)-\(index)"
                // iOS tracks an app's regions by identifier, so each geofence
                // needs its own; a shared one would silently replace another.
                let region = CLCircularRegion(center: center, radius: Self.regionRadius, identifier: identifier)
                region.notifyOnEntry = !reminder.leaving
                region.notifyOnExit = reminder.leaving
                let content = UNMutableNotificationContent()
                content.title = reminder.leaving ? "Leaving \(reminder.place)" : "At \(reminder.place)"
                content.body = reminder.notes.map { "\(reminder.title)\n\($0)" } ?? reminder.title
                content.sound = .default
                content.categoryIdentifier = ReminderNotificationPresenter.categoryIdentifier
                content.userInfo = ["reminderId": reminder.id]
                do {
                    try await notificationCenter.add(UNNotificationRequest(
                        identifier: identifier,
                        content: content,
                        trigger: UNLocationNotificationTrigger(region: region, repeats: false)
                    ))
                    armed += 1
                    remaining -= 1
                } catch {
                    continue
                }
            }
            // Report "armed" only when iOS actually accepted a geofence.
            statuses.append(["id": reminder.id, "status": armed > 0 ? "armed" : "notifications_off"])
        }
        return statuses
    }

    private func coordinates(for place: String) async -> [CLLocationCoordinate2D] {
        if let saved = SavedPlaces.match(place) {
            return [saved.coordinate]
        }
        // A store or landmark name: arm its nearest branches, searched on-device.
        guard let here = await currentLocation() else { return [] }
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = place
        request.region = MKCoordinateRegion(
            center: here.coordinate,
            latitudinalMeters: Self.searchRadius,
            longitudinalMeters: Self.searchRadius
        )
        guard let response = try? await MKLocalSearch(request: request).start() else { return [] }
        return response.mapItems
            .compactMap { $0.placemark.location }
            .filter { $0.distance(from: here) <= Self.searchRadius }
            .sorted { $0.distance(from: here) < $1.distance(from: here) }
            .prefix(Self.matchesPerSearch)
            .map(\.coordinate)
    }

    func cancel(reminderId: String) async {
        let center = UNUserNotificationCenter.current()
        let prefix = "\(Self.identifierPrefix)\(reminderId)-"
        let pending = await center.pendingNotificationRequests()
        center.removePendingNotificationRequests(
            withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix(prefix) }
        )
        center.removeDeliveredNotifications(
            withIdentifiers: (await center.deliveredNotifications()).map(\.request.identifier).filter { $0.hasPrefix(prefix) }
        )
    }
}

struct SavedPlace: Codable {
    let name: String
    let latitude: Double
    let longitude: Double

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

/// Saved places, kept only in this iPhone's Keychain.
enum SavedPlaces {
    private static let service = "com.ericcheng.vox.saved-places"
    private static let account = "places"

    /// Common names that refer to the same saved place.
    private static let aliases: [String: String] = [
        "家": "home", "我家": "home", "住處": "home", "回家": "home",
        "公司": "work", "辦公室": "work", "上班": "work", "office": "work",
    ]

    static func key(_ name: String) -> String {
        let normalized = name
            .folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: nil)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        return aliases[normalized] ?? normalized
    }

    static func match(_ place: String) -> SavedPlace? {
        let wanted = key(place)
        return load().first { key($0.name) == wanted }
    }

    private static var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    static func load() -> [SavedPlace] {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let places = try? JSONDecoder().decode([SavedPlace].self, from: data) else {
            return []
        }
        return places
    }

    @discardableResult
    static func save(_ places: [SavedPlace]) -> Bool {
        guard let data = try? JSONEncoder().encode(places) else { return false }
        var status = SecItemUpdate(baseQuery as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = baseQuery
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(item as CFDictionary, nil)
        }
        return status == errSecSuccess
    }
}
