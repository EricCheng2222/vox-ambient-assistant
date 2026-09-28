import CoreBluetooth
import CryptoKit
import Foundation

/// "Welcome home": keeps a low-power Bluetooth connection request open to the
/// paired Mac's Vox beacon. iOS wakes the app when the Mac comes back in range;
/// if that's after a long time apart, the app watches signal strength until
/// the owner has actually walked up to within a few metres, then sends the Mac
/// a signed arrival message so it can greet them. Nothing leaves the two
/// devices; the signature uses the existing phone-Mac pairing secret.
final class ProximityGreeter: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    static let shared = ProximityGreeter()

    // Must match desktop/VoxDesktop/native/vox-beacon.swift.
    private static let serviceUUID = CBUUID(string: "33F42BF2-D563-426D-A06E-ADD100C969C4")
    private static let arrivalUUID = CBUUID(string: "D6D76F26-05B8-4177-B9D2-D1590D9EC79B")
    private static let restoreIdentifier = "vox-welcome-home"

    private static let enabledKey = "vox.welcomeHome.enabled"
    private static let leftAtKey = "vox.welcomeHome.leftAt"
    private static let macIdentifierKey = "vox.welcomeHome.macIdentifier"

    /// Apart at least this long counts as "a long time".
    private static let awayThreshold: TimeInterval = 3 * 60 * 60
    /// Signal strength that roughly means "within about 5 metres" of a Mac.
    private static let nearRSSI = -72
    /// Readings this much weaker than "near" mean the owner started far away.
    private static let farMargin = 6
    private static let rangingTimeout: TimeInterval = 10 * 60

    private var central: CBCentralManager?
    private var mac: CBPeripheral?
    private var ranging = false
    private var rangingStarted = Date.distantPast
    private var samples: [Int] = []
    private var startedFar = false
    private var sending = false
    private var sendingTest = false
    private var pendingTest = false

    var isEnabled: Bool { UserDefaults.standard.bool(forKey: Self.enabledKey) }

    private struct Pairing { let deviceId: String; let secret: String }

    private var pairing: Pairing? {
        guard let json = PairingKeychain.load(),
              let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let deviceId = object["deviceId"] as? String,
              let secret = object["secret"] as? String else { return nil }
        return Pairing(deviceId: deviceId, secret: secret)
    }

    // MARK: Lifecycle

    func setEnabled(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: Self.enabledKey)
        if enabled { start() } else { stop() }
    }

    /// Call at launch too: iOS relaunches the app in the background for
    /// Bluetooth events, and the manager must be recreated to receive them.
    func start() {
        guard isEnabled, pairing != nil, central == nil else { return }
        central = CBCentralManager(
            delegate: self,
            queue: nil,
            options: [CBCentralManagerOptionRestoreIdentifierKey: Self.restoreIdentifier]
        )
    }

    /// The Test button: greets on the Mac right away, whatever the distance.
    func testNow() {
        pendingTest = true
        if central == nil {
            start()
            return
        }
        if let mac, mac.state == .connected {
            sendArrival(to: mac, test: true)
        } else if let mac, let central {
            central.connect(mac)
        }
    }

    func stop() {
        if let mac { central?.cancelPeripheralConnection(mac) }
        central?.stopScan()
        central = nil
        mac = nil
        ranging = false
    }

    // MARK: Central

    func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
        if let restored = (dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral])?.first {
            mac = restored
            restored.delegate = self
        }
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        guard central.state == .poweredOn else { return }
        if mac == nil,
           let saved = UserDefaults.standard.string(forKey: Self.macIdentifierKey).flatMap(UUID.init(uuidString:)) {
            mac = central.retrievePeripherals(withIdentifiers: [saved]).first
        }
        if let mac {
            mac.delegate = self
            if mac.state == .disconnected { central.connect(mac) }
        } else {
            central.scanForPeripherals(withServices: [Self.serviceUUID])
        }
    }

    func centralManager(
        _ central: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any],
        rssi RSSI: NSNumber
    ) {
        central.stopScan()
        mac = peripheral
        peripheral.delegate = self
        UserDefaults.standard.set(peripheral.identifier.uuidString, forKey: Self.macIdentifierKey)
        central.connect(peripheral)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        if pendingTest { sendArrival(to: peripheral, test: true) }
        let leftAt = UserDefaults.standard.object(forKey: Self.leftAtKey) as? Date
        // Only a return after a long time apart is worth a greeting.
        guard leftAt == nil || Date().timeIntervalSince(leftAt!) >= Self.awayThreshold else { return }
        ranging = true
        rangingStarted = Date()
        samples = []
        startedFar = false
        peripheral.readRSSI()
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        UserDefaults.standard.set(Date(), forKey: Self.leftAtKey)
        ranging = false
        sending = false
        // A pending connection never times out; iOS completes it when the Mac
        // is back in range, even hours later.
        if isEnabled { central.connect(peripheral) }
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        if isEnabled { central.connect(peripheral) }
    }

    // MARK: Ranging

    func peripheral(_ peripheral: CBPeripheral, didReadRSSI RSSI: NSNumber, error: Error?) {
        guard ranging else { return }
        if error == nil, RSSI.intValue < 0 {
            samples.append(RSSI.intValue)
            if samples.count > 5 { samples.removeFirst() }
        }
        if samples.count >= 3 {
            let median = samples.sorted()[samples.count / 2]
            if !startedFar {
                // Already close when the connection came back (say the Mac just
                // woke up next to them): they didn't just arrive.
                if median >= Self.nearRSSI {
                    ranging = false
                    return
                }
                startedFar = median <= Self.nearRSSI - Self.farMargin
            } else if median >= Self.nearRSSI {
                ranging = false
                sendArrival(to: peripheral)
                return
            }
        }
        if Date().timeIntervalSince(rangingStarted) > Self.rangingTimeout {
            ranging = false
            return
        }
        // Each reading is a Bluetooth event, which gives the app time to take
        // the next one even in the background.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            guard let self, self.ranging, peripheral.state == .connected else { return }
            peripheral.readRSSI()
        }
    }

    // MARK: Arrival

    private func sendArrival(to peripheral: CBPeripheral, test: Bool = false) {
        guard !sending else { return }
        sending = true
        sendingTest = test
        if test { pendingTest = false }
        peripheral.discoverServices([Self.serviceUUID])
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard sending, let service = peripheral.services?.first(where: { $0.uuid == Self.serviceUUID }) else {
            sending = false
            return
        }
        peripheral.discoverCharacteristics([Self.arrivalUUID], for: service)
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard sending,
              let characteristic = service.characteristics?.first(where: { $0.uuid == Self.arrivalUUID }),
              let message = signedArrival(test: sendingTest) else {
            sending = false
            return
        }
        peripheral.writeValue(message, for: characteristic, type: .withResponse)
    }

    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        sending = false
    }

    /// "<v1|t1>.<unix seconds>.<nonce>.<HMAC-SHA256, base64url>", verified by
    /// desktop/VoxDesktop/src/welcome-home-signature.mjs.
    private func signedArrival(test: Bool) -> Data? {
        guard let pairing else { return nil }
        let kind = test ? "t1" : "v1"
        let seconds = Int(Date().timeIntervalSince1970)
        let nonce = Self.base64URL(Data((0..<16).map { _ in UInt8.random(in: 0...255) }))
        let text = "vox-welcome-home.\(kind).\(pairing.deviceId).\(seconds).\(nonce)"
        let mac = HMAC<SHA256>.authenticationCode(for: Data(text.utf8), using: SymmetricKey(data: Data(pairing.secret.utf8)))
        return "\(kind).\(seconds).\(nonce).\(Self.base64URL(Data(mac)))".data(using: .utf8)
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
