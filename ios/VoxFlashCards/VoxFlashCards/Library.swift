import Foundation

struct Deck: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var description: String?
    var cardCount: Int
    var dueCount: Int

    /// "KMU Post-Bac: Genetics" reads as "Genetics", with the series as a label.
    var title: String { split.title }
    var series: String? { split.series }

    private var split: (series: String?, title: String) {
        guard let range = name.range(of: ": "), name.distance(from: name.startIndex, to: range.lowerBound) < 30 else {
            return (nil, name)
        }
        return (String(name[..<range.lowerBound]), String(name[range.upperBound...]))
    }
}

struct Card: Codable, Identifiable, Hashable {
    let id: String
    var deckId: String
    var front: String
    var back: String
    var notes: String?
    var ease: Double
    var intervalDays: Double
    var reps: Int
    var lapses: Int
    var dueAt: Date
    var lastReviewedAt: Date?
    /// When the card was last shown and graded or skipped.
    var seenAt: Date?
}

enum Rating: String, Codable, CaseIterable, Identifiable {
    case again, hard, good, easy
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
    var hint: String {
        switch self {
        case .again: return "forgot"
        case .hard: return "struggled"
        case .good: return "knew it"
        case .easy: return "instantly"
        }
    }
}

/// A grade made on this iPhone, waiting to be sent to Vox Flash Cards.
struct PendingReview: Codable, Identifiable, Hashable {
    let id: String
    let cardId: String
    let rating: Rating
    let reviewedAt: Date
}

/// The same SM-2 style schedule as the website (flashcards-site/src/srs.ts),
/// so cards studied offline come due exactly as they would online.
enum Scheduler {
    private static let day: TimeInterval = 86_400
    private static let relearnDelay: TimeInterval = 60
    private static let minEase = 1.3
    private static let maxInterval = 3_650.0

    static func review(_ card: Card, _ rating: Rating, at now: Date) -> Card {
        var next = card
        next.lastReviewedAt = now
        next.seenAt = now
        if rating == .again {
            next.ease = max(minEase, card.ease - 0.2)
            next.intervalDays = 0
            next.reps = 0
            next.lapses = card.lapses + 1
            next.dueAt = now.addingTimeInterval(relearnDelay)
            return next
        }
        var ease = card.ease
        var interval: Double
        switch rating {
        case .hard:
            ease = max(minEase, ease - 0.15)
            interval = card.reps == 0 ? 1 : max(1, card.intervalDays * 1.2)
        case .good:
            interval = card.reps == 0 ? 1 : card.reps == 1 ? 3 : card.intervalDays * ease
        default:
            ease += 0.15
            interval = card.reps == 0 ? 4 : max(4, card.intervalDays * ease * 1.3)
        }
        interval = min(maxInterval, (interval * 10).rounded() / 10)
        next.ease = (ease * 100).rounded() / 100
        next.intervalDays = interval
        next.reps = card.reps + 1
        next.dueAt = now.addingTimeInterval(interval * day)
        return next
    }
}

private struct DecksResponse: Decodable { let decks: [Deck] }
private struct DeckResponse: Decodable { let deck: Deck; let cards: [Card] }
private struct MeResponse: Decodable { struct User: Decodable { let name: String }; let user: User }
private struct ReviewsResponse: Decodable {
    struct Result: Decodable { let id: String; let status: String; let card: Card? }
    let results: [Result]
}

/// Everything saved on the iPhone: the account's deck list, the decks
/// downloaded for offline study, and grades not yet synced.
private struct Snapshot: Codable {
    var remoteDecks: [Deck] = []
    var downloaded: [String: DownloadedDeck] = [:]
    var pending: [PendingReview] = []
    var lastSync: Date?
    var sinceRepeat: Int?
    var sinceRepeatDay: String?
}

struct DownloadedDeck: Codable, Hashable {
    var deck: Deck
    var cards: [Card]
    var downloadedAt: Date
}

enum SyncState: Equatable {
    case idle, syncing, offline, failed(String)
}

@MainActor
final class Library: ObservableObject {
    @Published private(set) var remoteDecks: [Deck] = []
    @Published private(set) var downloaded: [String: DownloadedDeck] = [:]
    @Published private(set) var pending: [PendingReview] = []
    @Published private(set) var lastSync: Date?
    @Published private(set) var syncState: SyncState = .idle
    @Published private(set) var downloading: Set<String> = []

    /// New cards shown since a missed card last came back (per day).
    private var sinceRepeat = 0
    private var sinceRepeatDay = ""
    static let repeatMissedEvery = 10

    private let auth: AuthManager
    private var api: APIClient { APIClient(auth: auth) }
    private var pushTask: Task<Void, Never>?

    private static var fileURL: URL {
        let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("VoxFlashCards", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder.appendingPathComponent("library.json")
    }

    init(auth: AuthManager) {
        self.auth = auth
        if let data = try? Data(contentsOf: Self.fileURL),
           let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data) {
            remoteDecks = snapshot.remoteDecks
            downloaded = snapshot.downloaded
            pending = snapshot.pending
            lastSync = snapshot.lastSync
            sinceRepeat = snapshot.sinceRepeat ?? 0
            sinceRepeatDay = snapshot.sinceRepeatDay ?? ""
        }
    }

    private func save() {
        let snapshot = Snapshot(
            remoteDecks: remoteDecks, downloaded: downloaded, pending: pending, lastSync: lastSync,
            sinceRepeat: sinceRepeat, sinceRepeatDay: sinceRepeatDay
        )
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        try? data.write(to: Self.fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    /// Removes everything saved on this iPhone (on sign-out).
    func erase() {
        pushTask?.cancel()
        remoteDecks = []
        downloaded = [:]
        pending = []
        lastSync = nil
        syncState = .idle
        try? FileManager.default.removeItem(at: Self.fileURL)
    }

    // MARK: Studying (works offline)

    var downloadedDecks: [DownloadedDeck] {
        downloaded.values.sorted { $0.deck.name.localizedStandardCompare($1.deck.name) == .orderedAscending }
    }

    /// Due cards in study order, matching the website: a fresh random order
    /// each day, and a card seen today (graded, missed, or skipped) waits until
    /// every other due card has had its turn.
    func dueCards(in deckIds: Set<String>?, at now: Date = Date()) -> [Card] {
        let startOfDay = Calendar.current.startOfDay(for: now)
        let day = ISO8601.plain.string(from: startOfDay)
        func seenToday(_ card: Card) -> Bool { (card.seenAt ?? .distantPast) >= startOfDay }
        return downloaded.values
            .filter { deckIds?.contains($0.deck.id) ?? true }
            .flatMap(\.cards)
            .filter { $0.dueAt <= now }
            .map { (card: $0, seen: seenToday($0), key: Self.shuffleKey($0.id, day)) }
            .sorted { a, b in
                if a.seen != b.seen { return !a.seen }
                if a.seen, let first = a.card.seenAt, let second = b.card.seenAt, first != second { return first < second }
                return a.key < b.key
            }
            .map(\.card)
    }

    /// The card to show next: every 10 new cards, the oldest card missed today
    /// comes back once; otherwise the next card in today's order.
    func nextCard(in deckIds: Set<String>?, at now: Date = Date()) -> (card: Card, isRepeat: Bool)? {
        let due = dueCards(in: deckIds, at: now)
        let startOfDay = Calendar.current.startOfDay(for: now)
        if sinceRepeatDay == Self.dayKey(now), sinceRepeat >= Self.repeatMissedEvery,
           let missed = due
            .filter({ ($0.lastReviewedAt ?? .distantPast) >= startOfDay && $0.reps == 0 && $0.lapses > 0 })
            .min(by: { ($0.seenAt ?? .distantPast) < ($1.seenAt ?? .distantPast) }) {
            return (missed, true)
        }
        return due.first.map { ($0, false) }
    }

    private func countShown(_ card: Card, at now: Date) {
        let day = Self.dayKey(now)
        let isRepeat = (card.seenAt ?? .distantPast) >= Calendar.current.startOfDay(for: now)
        sinceRepeat = isRepeat ? 0 : (sinceRepeatDay == day ? sinceRepeat + 1 : 1)
        sinceRepeatDay = day
    }

    private static func dayKey(_ date: Date) -> String {
        ISO8601.plain.string(from: Calendar.current.startOfDay(for: date))
    }

    /// A stable pseudo-random number per card per day (FNV-1a).
    private static func shuffleKey(_ id: String, _ day: String) -> UInt64 {
        var hash: UInt64 = 0xCBF2_9CE4_8422_2325
        for byte in "\(day)|\(id)".utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x0000_0100_0000_01B3
        }
        return hash
    }

    func nextDue(in deckIds: Set<String>?, after now: Date = Date()) -> Date? {
        downloaded.values
            .filter { deckIds?.contains($0.deck.id) ?? true }
            .flatMap(\.cards)
            .map(\.dueAt)
            .filter { $0 > now }
            .min()
    }

    func deck(_ id: String) -> Deck? {
        downloaded[id]?.deck ?? remoteDecks.first { $0.id == id }
    }

    func grade(_ card: Card, _ rating: Rating) {
        let now = Date()
        countShown(card, at: now)
        replace(Scheduler.review(card, rating, at: now))
        pending.append(PendingReview(id: UUID().uuidString.lowercased(), cardId: card.id, rating: rating, reviewedAt: now))
        save()
        schedulePush()
    }

    /// Sends a card to the back of today's pile. Only on this iPhone; nothing to sync.
    func skip(_ card: Card) {
        countShown(card, at: Date())
        var moved = card
        moved.seenAt = Date()
        replace(moved)
        save()
    }

    private func replace(_ card: Card) {
        guard var entry = downloaded[card.deckId], let index = entry.cards.firstIndex(where: { $0.id == card.id }) else { return }
        entry.cards[index] = card
        downloaded[card.deckId] = entry
    }

    // MARK: Downloads

    func download(_ deck: Deck) async {
        downloading.insert(deck.id)
        defer { downloading.remove(deck.id) }
        do {
            try await pushPending()
            let response: DeckResponse = try await api.get("api/app/deck", query: ["id": deck.id])
            downloaded[deck.id] = DownloadedDeck(deck: response.deck, cards: response.cards, downloadedAt: Date())
            save()
            syncState = .idle
        } catch {
            report(error)
        }
    }

    func removeDownload(_ deckId: String) {
        // Unsynced grades for this deck stay queued and still sync.
        downloaded[deckId] = nil
        save()
    }

    // MARK: Sync

    /// Sends queued grades, refreshes the deck list, and re-downloads each
    /// downloaded deck so it matches the account.
    func sync() async {
        guard auth.isSignedIn, syncState != .syncing else { return }
        syncState = .syncing
        do {
            try await pushPending()
            let offset = String(TimeZone.current.secondsFromGMT() / 60)
            let me: MeResponse = try await api.get("api/app/me", query: ["offset": offset])
            auth.setUserName(me.user.name)
            let list: DecksResponse = try await api.get("api/app/decks")
            remoteDecks = list.decks
            for id in Array(downloaded.keys) {
                guard list.decks.contains(where: { $0.id == id }) else {
                    downloaded[id] = nil
                    continue
                }
                let response: DeckResponse = try await api.get("api/app/deck", query: ["id": id])
                // Keep any grade made while this download was in flight.
                let localNewer = Dictionary(uniqueKeysWithValues: (downloaded[id]?.cards ?? []).map { ($0.id, $0) })
                let cards = response.cards.map { remote -> Card in
                    if let local = localNewer[remote.id], pending.contains(where: { $0.cardId == remote.id }) { return local }
                    return remote
                }
                downloaded[id] = DownloadedDeck(deck: response.deck, cards: cards, downloadedAt: Date())
            }
            lastSync = Date()
            save()
            syncState = .idle
        } catch {
            report(error)
        }
    }

    /// Sends grades soon after they're made, without re-downloading decks.
    private func schedulePush() {
        pushTask?.cancel()
        pushTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard let self, !Task.isCancelled else { return }
            do {
                try await self.pushPending()
                self.lastSync = Date()
                self.save()
                if self.syncState == .offline { self.syncState = .idle }
            } catch {
                self.report(error)
            }
        }
    }

    private func pushPending() async throws {
        while !pending.isEmpty {
            let batch = Array(pending.prefix(200))
            let body: [String: Any] = ["reviews": batch.map {
                ["id": $0.id, "card_id": $0.cardId, "rating": $0.rating.rawValue, "reviewed_at": ISO8601.withFraction.string(from: $0.reviewedAt)]
            }]
            let response: ReviewsResponse = try await api.post("api/app/reviews", body: body)
            let done = Set(response.results.map(\.id))
            for result in response.results {
                // A newer grade from elsewhere wins; take the account's copy.
                if let card = result.card, result.status == "stale" { replace(card) }
                if result.status == "missing" { removeCard(batch.first { $0.id == result.id }?.cardId) }
            }
            pending.removeAll { done.contains($0.id) }
            save()
            if done.isEmpty { break }
        }
    }

    private func removeCard(_ cardId: String?) {
        guard let cardId else { return }
        for (id, var entry) in downloaded where entry.cards.contains(where: { $0.id == cardId }) {
            entry.cards.removeAll { $0.id == cardId }
            downloaded[id] = entry
        }
    }

    private func report(_ error: Error) {
        if error is CancellationError { syncState = .idle; return }
        switch error {
        case AppError.offline: syncState = .offline
        case AppError.signedOut: syncState = .failed("Sign in again to sync.")
        default: syncState = .failed(error.localizedDescription)
        }
    }
}
