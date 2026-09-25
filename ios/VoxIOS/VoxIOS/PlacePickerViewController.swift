import MapKit
import UIKit

/// A full-screen map for choosing where a saved place is. The user searches
/// or pans the map under a fixed center pin; a circle shows the area that
/// triggers the place's reminders. Nothing leaves the device.
final class PlacePickerViewController: UIViewController, MKMapViewDelegate, UISearchBarDelegate,
    UITableViewDataSource, UITableViewDelegate, UITextFieldDelegate {
    private let initialName: String
    private let start: CLLocationCoordinate2D?
    private let radius: CLLocationDistance
    private let showsUserLocation: Bool
    private var completion: (((name: String, coordinate: CLLocationCoordinate2D)?) -> Void)?

    private let mapView = MKMapView()
    private let searchBar = UISearchBar()
    private let resultsTable = UITableView(frame: .zero, style: .plain)
    private let nameField = UITextField()
    private let pin = UIImageView(image: UIImage(systemName: "mappin.circle.fill"))
    private var results: [MKMapItem] = []
    private var areaCircle: MKCircle?
    private var nameWasSuggested = false
    private var search: MKLocalSearch?
    private var bottomCard: UIView?
    private var pinOffset: NSLayoutConstraint?
    private var resultsHeight: NSLayoutConstraint?

    /// Taipei, used only when there is no saved spot or current location.
    private static let fallbackCenter = CLLocationCoordinate2D(latitude: 25.0330, longitude: 121.5654)

    init(
        name: String,
        start: CLLocationCoordinate2D?,
        radius: CLLocationDistance,
        showsUserLocation: Bool,
        completion: @escaping ((name: String, coordinate: CLLocationCoordinate2D)?) -> Void
    ) {
        initialName = name
        self.start = start
        self.radius = radius
        self.showsUserLocation = showsUserLocation
        self.completion = completion
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        title = "Choose a place"
        navigationItem.leftBarButtonItem = UIBarButtonItem(
            systemItem: .cancel,
            primaryAction: UIAction { [weak self] _ in self?.finish(nil) }
        )
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            title: "Save",
            primaryAction: UIAction { [weak self] _ in self?.save() }
        )
        navigationItem.rightBarButtonItem?.style = .done

        mapView.delegate = self
        mapView.showsUserLocation = showsUserLocation
        mapView.pointOfInterestFilter = .includingAll
        mapView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(mapView)

        pin.tintColor = .systemRed
        pin.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 34, weight: .semibold)
        pin.translatesAutoresizingMaskIntoConstraints = false
        pin.isAccessibilityElement = true
        pin.accessibilityLabel = "Place pin. Move the map to position it."
        view.addSubview(pin)

        searchBar.placeholder = "Search for an address or place"
        searchBar.searchBarStyle = .minimal
        searchBar.backgroundColor = .systemBackground
        searchBar.delegate = self
        searchBar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(searchBar)

        resultsTable.dataSource = self
        resultsTable.delegate = self
        resultsTable.isHidden = true
        resultsTable.layer.cornerRadius = 12
        resultsTable.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(resultsTable)

        let card = makeBottomCard()
        bottomCard = card
        view.addSubview(card)

        let recenter = UIButton(configuration: .filled())
        recenter.configuration?.image = UIImage(systemName: "location.fill")
        recenter.configuration?.cornerStyle = .capsule
        recenter.configuration?.baseBackgroundColor = .systemBackground
        recenter.configuration?.baseForegroundColor = .systemBlue
        recenter.accessibilityLabel = "Center on my location"
        recenter.isHidden = !showsUserLocation
        recenter.translatesAutoresizingMaskIntoConstraints = false
        recenter.addAction(UIAction { [weak self] _ in self?.centerOnUser() }, for: .touchUpInside)
        view.addSubview(recenter)

        NSLayoutConstraint.activate([
            searchBar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            searchBar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 8),
            searchBar.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -8),

            mapView.topAnchor.constraint(equalTo: searchBar.bottomAnchor),
            mapView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            mapView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            mapView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            resultsTable.topAnchor.constraint(equalTo: searchBar.bottomAnchor, constant: 4),
            resultsTable.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            resultsTable.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),

            // The pin's point marks the map center.
            pin.centerXAnchor.constraint(equalTo: mapView.centerXAnchor),

            card.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            card.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
            card.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor, constant: -12),

            recenter.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            recenter.bottomAnchor.constraint(equalTo: card.topAnchor, constant: -12),
            recenter.widthAnchor.constraint(equalToConstant: 44),
            recenter.heightAnchor.constraint(equalToConstant: 44),
        ])

        let offset = pin.bottomAnchor.constraint(equalTo: mapView.centerYAnchor, constant: 4)
        let height = resultsTable.heightAnchor.constraint(equalToConstant: 0)
        NSLayoutConstraint.activate([offset, height])
        pinOffset = offset
        resultsHeight = height

        let center = start ?? Self.fallbackCenter
        mapView.setRegion(
            MKCoordinateRegion(center: center, latitudinalMeters: 900, longitudinalMeters: 900),
            animated: false
        )
        updateArea()
        updateSaveButton()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // Keep Apple Maps' legal attribution and compass above the name card.
        guard let bottomCard else { return }
        let covered = max(0, mapView.frame.maxY - bottomCard.frame.minY + 8)
        guard mapView.layoutMargins.bottom != covered else { return }
        let center = mapView.centerCoordinate
        mapView.layoutMargins = UIEdgeInsets(top: 0, left: 8, bottom: covered, right: 8)
        // The map centers regions inside its margins, so raise the pin to that
        // center and keep the same spot under it.
        pinOffset?.constant = 4 - covered / 2
        mapView.setCenter(center, animated: false)
    }

    private func makeBottomCard() -> UIView {
        let card = UIView()
        card.backgroundColor = .secondarySystemBackground
        card.layer.cornerRadius = 16
        card.translatesAutoresizingMaskIntoConstraints = false

        nameField.text = initialName
        nameField.placeholder = "Place name, e.g. Home"
        nameField.borderStyle = .roundedRect
        nameField.returnKeyType = .done
        nameField.clearButtonMode = .whileEditing
        nameField.delegate = self
        nameField.addAction(UIAction { [weak self] _ in
            self?.nameWasSuggested = false
            self?.updateSaveButton()
        }, for: .editingChanged)

        let hint = UILabel()
        hint.text = "Move the map to put the pin on the spot. Reminders fire within about \(Int(radius)) m. The location stays on this iPhone."
        hint.font = .preferredFont(forTextStyle: .footnote)
        hint.textColor = .secondaryLabel
        hint.numberOfLines = 0

        let stack = UIStackView(arrangedSubviews: [nameField, hint])
        stack.axis = .vertical
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 14),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -14),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -14),
            nameField.heightAnchor.constraint(greaterThanOrEqualToConstant: 40),
        ])
        return card
    }

    // MARK: Actions

    private func save() {
        guard let name = trimmedName else {
            nameField.becomeFirstResponder()
            return
        }
        finish((name, mapView.centerCoordinate))
    }

    private func finish(_ result: (name: String, coordinate: CLLocationCoordinate2D)?) {
        search?.cancel()
        let completion = completion
        self.completion = nil
        dismiss(animated: true) { completion?(result) }
    }

    private var trimmedName: String? {
        let name = (nameField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty ? nil : String(name.prefix(40))
    }

    private func updateSaveButton() {
        navigationItem.rightBarButtonItem?.isEnabled = trimmedName != nil
    }

    private func centerOnUser() {
        guard let location = mapView.userLocation.location else { return }
        mapView.setCenter(location.coordinate, animated: true)
    }

    private func updateArea() {
        if let areaCircle { mapView.removeOverlay(areaCircle) }
        let circle = MKCircle(center: mapView.centerCoordinate, radius: radius)
        areaCircle = circle
        mapView.addOverlay(circle)
    }

    // MARK: Map

    func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
        updateArea()
    }

    func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
        let renderer = MKCircleRenderer(overlay: overlay)
        renderer.fillColor = UIColor.systemBlue.withAlphaComponent(0.12)
        renderer.strokeColor = UIColor.systemBlue.withAlphaComponent(0.6)
        renderer.lineWidth = 1.5
        return renderer
    }

    // MARK: Search

    func searchBarSearchButtonClicked(_ searchBar: UISearchBar) {
        guard let query = searchBar.text?.trimmingCharacters(in: .whitespacesAndNewlines), !query.isEmpty else { return }
        searchBar.resignFirstResponder()
        search?.cancel()
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = query
        request.region = mapView.region
        let search = MKLocalSearch(request: request)
        self.search = search
        search.start { [weak self] response, _ in
            guard let self else { return }
            self.results = Array((response?.mapItems ?? []).prefix(8))
            self.resultsTable.reloadData()
            self.resultsHeight?.constant = min(CGFloat(self.results.count) * 60, 320)
            self.resultsTable.isHidden = self.results.isEmpty
        }
    }

    func searchBar(_ searchBar: UISearchBar, textDidChange searchText: String) {
        if searchText.isEmpty {
            results = []
            resultsTable.reloadData()
            resultsTable.isHidden = true
        }
    }

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        results.count
    }

    func tableView(_ tableView: UITableView, heightForRowAt indexPath: IndexPath) -> CGFloat { 60 }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        let item = results[indexPath.row]
        cell.textLabel?.text = item.name
        cell.detailTextLabel?.text = item.placemark.title
        cell.detailTextLabel?.textColor = .secondaryLabel
        return cell
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        let item = results[indexPath.row]
        tableView.isHidden = true
        mapView.setRegion(
            MKCoordinateRegion(center: item.placemark.coordinate, latitudinalMeters: 600, longitudinalMeters: 600),
            animated: true
        )
        // Suggest the result's name unless the user already chose one.
        if trimmedName == nil || nameWasSuggested, let suggestion = item.name {
            nameField.text = String(suggestion.prefix(40))
            nameWasSuggested = true
            updateSaveButton()
        }
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        textField.resignFirstResponder()
        return true
    }
}

