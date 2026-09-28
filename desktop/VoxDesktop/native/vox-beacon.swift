// Vox beacon: a tiny Bluetooth LE peripheral for the "welcome home" greeting.
// It advertises the Vox service so the paired iPhone can find this Mac, and
// accepts one write, the iPhone's signed arrival message, which it prints to
// stdout as a JSON line for the desktop app to verify. It knows nothing about
// secrets; verification happens in the app. Exits when stdin closes.
import CoreBluetooth
import Foundation

let serviceUUID = CBUUID(string: "33F42BF2-D563-426D-A06E-ADD100C969C4")
let arrivalUUID = CBUUID(string: "D6D76F26-05B8-4177-B9D2-D1590D9EC79B")

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

final class Beacon: NSObject, CBPeripheralManagerDelegate {
    private var manager: CBPeripheralManager!

    override init() {
        super.init()
        manager = CBPeripheralManager(delegate: self, queue: nil)
    }

    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        let state: String
        switch peripheral.state {
        case .poweredOn: state = "on"
        case .poweredOff: state = "off"
        case .unauthorized: state = "unauthorized"
        case .unsupported: state = "unsupported"
        default: state = "unknown"
        }
        emit(["type": "state", "state": state])
        guard peripheral.state == .poweredOn else { return }
        let arrival = CBMutableCharacteristic(type: arrivalUUID, properties: [.write], value: nil, permissions: [.writeable])
        let service = CBMutableService(type: serviceUUID, primary: true)
        service.characteristics = [arrival]
        peripheral.removeAllServices()
        peripheral.add(service)
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
        if let error {
            emit(["type": "error", "message": error.localizedDescription])
            return
        }
        peripheral.startAdvertising([
            CBAdvertisementDataServiceUUIDsKey: [serviceUUID],
            CBAdvertisementDataLocalNameKey: "Vox",
        ])
    }

    func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
        if let error {
            emit(["type": "error", "message": error.localizedDescription])
        } else {
            emit(["type": "advertising"])
        }
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
        for request in requests where request.characteristic.uuid == arrivalUUID {
            if let value = request.value, value.count <= 256, let text = String(data: value, encoding: .utf8) {
                emit(["type": "arrival", "payload": text])
            }
        }
        if let first = requests.first {
            peripheral.respond(to: first, withResult: .success)
        }
    }
}

emit(["type": "started"])
let beacon = Beacon()
// Quit with the desktop app: it holds our stdin open.
FileHandle.standardInput.readabilityHandler = { handle in
    if handle.availableData.isEmpty { exit(0) }
}
RunLoop.main.run()
