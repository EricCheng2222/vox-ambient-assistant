import Charts
import SwiftUI

/// The same numbers as the website's Statistics page (GET /api/app/stats).
struct StudyStats: Codable, Equatable {
    struct Totals: Codable, Equatable {
        let cards, due, new, learning, young, mature: Int
    }
    struct Ratings: Codable, Equatable {
        let again, hard, good, easy: Int
    }
    struct Last30: Codable, Equatable {
        let reviews: Int
        let ratings: Ratings
        let accuracy: Double?
    }
    struct Day: Codable, Equatable, Identifiable {
        let day: String
        var reviews: Int?
        var due: Int?
        var id: String { day }
    }
    struct DeckStats: Codable, Equatable, Identifiable {
        let id: String
        let name: String
        let cards, due, new, learning, young, mature, reviews30: Int
        let accuracy30: Double?
    }
    struct Slipping: Codable, Equatable, Identifiable {
        let id: String
        let front: String
        let back: String
        let lapses: Int
        let deck: String
    }

    let today: String
    let totals: Totals
    let studiedToday: Int
    let streak: Int
    let daysStudied: Int
    let last30: Last30
    let activity: [Day]
    let forecast: [Day]
    let decks: [DeckStats]
    let hardest: [Slipping]
}

@MainActor
final class StatsStore: ObservableObject {
    @Published private(set) var stats: StudyStats?
    @Published private(set) var updatedAt: Date?
    @Published private(set) var loading = false
    @Published private(set) var error: String?

    private static var fileURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("VoxFlashCards/stats.json")
    }

    private struct Cached: Codable { let stats: StudyStats; let updatedAt: Date }
    private struct Response: Decodable { let stats: StudyStats }

    init() {
        if let data = try? Data(contentsOf: Self.fileURL), let cached = try? JSONDecoder().decode(Cached.self, from: data) {
            stats = cached.stats
            updatedAt = cached.updatedAt
        }
    }

    /// Sends unsynced grades first so the numbers include them, then loads.
    func load(auth: AuthManager, library: Library) async {
        guard auth.isSignedIn, !loading else { return }
        loading = true
        defer { loading = false }
        await library.refreshChanges()
        do {
            let offset = String(TimeZone.current.secondsFromGMT() / 60)
            let response: Response = try await APIClient(auth: auth).get("api/app/stats", query: ["offset": offset])
            stats = response.stats
            updatedAt = Date()
            error = nil
            if let data = try? JSONEncoder().encode(Cached(stats: response.stats, updatedAt: Date())) {
                try? data.write(to: Self.fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            }
        } catch AppError.offline {
            error = stats == nil ? "You’re offline. Statistics load when you’re back online." : nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    func erase() {
        stats = nil
        updatedAt = nil
        try? FileManager.default.removeItem(at: Self.fileURL)
    }
}

// MARK: Views

struct StatsView: View {
    @EnvironmentObject private var auth: AuthManager
    @EnvironmentObject private var library: Library
    @EnvironmentObject private var store: StatsStore
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                if let stats = store.stats {
                    summary(stats)
                    if sizeClass == .regular {
                        HStack(alignment: .top, spacing: 22) {
                            forecast(stats)
                            answers(stats)
                        }
                    } else {
                        forecast(stats)
                        answers(stats)
                    }
                    activity(stats)
                    decks(stats)
                    slipping(stats)
                } else if store.loading {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
                }
                if let error = store.error {
                    Text(error).font(.footnote).foregroundStyle(Palette.grade(.again))
                }
                if let updated = store.updatedAt {
                    Text("Updated \(updated.formatted(.relative(presentation: .named))). Pull down to refresh.")
                        .font(.footnote)
                        .foregroundStyle(Palette.inkSoft)
                }
            }
            .frame(maxWidth: 900)
            .padding(.horizontal, sizeClass == .regular ? 32 : 20)
            .padding(.bottom, 40)
            .frame(maxWidth: .infinity)
        }
        .background(Palette.desk.ignoresSafeArea())
        .navigationTitle("Statistics")
        .refreshable { await store.load(auth: auth, library: library) }
        .task { await store.load(auth: auth, library: library) }
    }

    // MARK: Sections

    private func summary(_ stats: StudyStats) -> some View {
        IndexCard(topLeft: "Your progress", topRight: dayLabel(stats.today, .dateTime.weekday(.wide).month().day())) {
            VStack(alignment: .leading, spacing: 18) {
                Text(sentence(stats))
                    .font(.cardFace(24))
                    .foregroundStyle(Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), alignment: .topLeading)], alignment: .leading, spacing: 14) {
                    figure("\(stats.studiedToday)", "reviewed today")
                    figure(stats.last30.accuracy.map { "\(Int(($0 * 100).rounded()))%" } ?? "–", "correct, last 30 days")
                    figure("\(stats.totals.mature)", "cards learned well")
                    figure("\(stats.totals.due)", "due now")
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 18)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private func forecast(_ stats: StudyStats) -> some View {
        let byDay = Dictionary(uniqueKeysWithValues: stats.forecast.map { ($0.day, $0.due ?? 0) })
        let days = (0..<14).map { offset -> (label: String, day: String, due: Int) in
            let day = shiftDay(stats.today, offset)
            // Phones are too narrow for "Today"; its bar is the red one.
            return (offset == 0 && sizeClass == .regular ? "Today" : dayLabel(day, .dateTime.weekday(.narrow)), day, byDay[day] ?? 0)
        }
        return panel("Coming due, next 14 days", trailing: sizeClass == .regular ? "" : "Red is today") {
            Chart(days, id: \.day) { item in
                BarMark(x: .value("Day", item.day), y: .value("Due", item.due))
                    .foregroundStyle(item.day == stats.today ? Palette.margin : Color(hex: 0x2F55B5))
                    .cornerRadius(3)
                    .annotation(position: .top) {
                        if item.due > 0 {
                            Text("\(item.due)").font(.caption2.weight(.semibold)).foregroundStyle(Palette.ink)
                        }
                    }
            }
            .chartXAxis {
                AxisMarks(values: days.map(\.day)) { value in
                    AxisValueLabel {
                        if let day = value.as(String.self) {
                            Text(days.first { $0.day == day }?.label ?? "").font(.caption2)
                        }
                    }
                }
            }
            .chartYAxis(.hidden)
            .frame(height: 170)
        }
    }

    private func answers(_ stats: StudyStats) -> some View {
        let ratings = stats.last30.ratings
        let answerParts: [(String, Int, Color)] = [
            ("Again", ratings.again, Palette.grade(.again)), ("Hard", ratings.hard, Palette.grade(.hard)),
            ("Good", ratings.good, Palette.grade(.good)), ("Easy", ratings.easy, Palette.grade(.easy)),
        ]
        return panel("Your answers, last 30 days", trailing: stats.last30.reviews > 0 ? "\(stats.last30.reviews) answers" : "") {
            VStack(alignment: .leading, spacing: 12) {
                if stats.last30.reviews > 0 {
                    StackBar(parts: answerParts)
                    Legend(parts: answerParts)
                } else {
                    Text("No answers yet in the last 30 days.").foregroundStyle(Color(hex: 0x6B7690))
                }
                Text("All cards").font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink).padding(.top, 6)
                StackBar(parts: maturityParts(new: stats.totals.new, learning: stats.totals.learning, young: stats.totals.young, mature: stats.totals.mature))
                Legend(parts: maturityParts(new: stats.totals.new, learning: stats.totals.learning, young: stats.totals.young, mature: stats.totals.mature))
            }
        }
    }

    private func activity(_ stats: StudyStats) -> some View {
        let counts = Dictionary(uniqueKeysWithValues: stats.activity.map { ($0.day, $0.reviews ?? 0) })
        let peak = max(1, counts.values.max() ?? 1)
        let total = counts.values.reduce(0, +)
        return panel("Daily activity", trailing: total > 0 ? "\(total) reviews over \(stats.daysStudied) days" : "Grade a card and it shows up here") {
            GeometryReader { geometry in
                let cell: CGFloat = 13, gap: CGFloat = 3
                let weeks = max(4, min(53, Int((geometry.size.width + gap) / (cell + gap))))
                // Columns are weeks (Monday first), ending with this week.
                let weekday = (Calendar(identifier: .iso8601).component(.weekday, from: date(stats.today)) + 5) % 7
                let start = shiftDay(stats.today, -((weeks - 1) * 7 + weekday))
                HStack(alignment: .top, spacing: gap) {
                    ForEach(0..<weeks, id: \.self) { week in
                        VStack(spacing: gap) {
                            ForEach(0..<7, id: \.self) { row in
                                let day = shiftDay(start, week * 7 + row)
                                let reviews = counts[day] ?? 0
                                RoundedRectangle(cornerRadius: 3)
                                    .fill(day > stats.today ? Color.clear : heat(reviews, peak))
                                    .frame(width: cell, height: cell)
                            }
                        }
                    }
                }
            }
            .frame(height: 7 * 13 + 6 * 3)
            .accessibilityLabel("Reviews per day")
        }
    }

    private func decks(_ stats: StudyStats) -> some View {
        panel("Decks", trailing: "learned well of all cards") {
            VStack(alignment: .leading, spacing: 16) {
                ForEach(stats.decks) { deck in
                    let name = Deck(id: deck.id, name: deck.name, description: nil, cardCount: deck.cards, dueCount: deck.due)
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: 1) {
                                if let series = name.series { Text(series).font(.caption).foregroundStyle(Palette.faint) }
                                Text(name.title).font(.cardFace(18)).foregroundStyle(Palette.ink)
                            }
                            Spacer()
                            Text("\(deck.mature) of \(deck.cards)" + (deck.accuracy30.map { ", \(Int(($0 * 100).rounded()))% correct" } ?? ""))
                                .font(.footnote)
                                .foregroundStyle(Color(hex: 0x5B6784))
                        }
                        StackBar(parts: maturityParts(new: deck.new, learning: deck.learning, young: deck.young, mature: deck.mature))
                    }
                }
                if stats.decks.isEmpty {
                    Text("No decks yet.").foregroundStyle(Color(hex: 0x6B7690))
                }
            }
        }
    }

    private func slipping(_ stats: StudyStats) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Cards that keep slipping").font(.headline).foregroundStyle(Palette.heading)
            if stats.hardest.isEmpty {
                Text("Nothing yet. Cards you forget more than once collect here so you can give them extra attention.")
                    .foregroundStyle(Palette.inkSoft)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 14)], spacing: 14) {
                    ForEach(stats.hardest) { card in
                        let deck = Deck(id: "", name: card.deck, description: nil, cardCount: 0, dueCount: 0)
                        IndexCard(topLeft: deck.title, topRight: "Forgot \(card.lapses) \(card.lapses == 1 ? "time" : "times")") {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(card.front).font(.cardFace(17)).foregroundStyle(Palette.ink)
                                Text(card.back).font(.cardFace(15)).foregroundStyle(Color(hex: 0x56627E))
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 14)
                        }
                        .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    // MARK: Pieces

    private func panel<Content: View>(_ title: String, trailing: String = "", @ViewBuilder content: () -> Content) -> some View {
        IndexCard(topLeft: title, topRight: trailing) {
            content()
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private func figure(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.cardFace(32).weight(.semibold)).foregroundStyle(Palette.ink)
            Text(label).font(.caption).foregroundStyle(Color(hex: 0x5B6784))
        }
    }

    private func sentence(_ stats: StudyStats) -> String {
        if stats.streak > 1 { return "You’ve studied \(stats.streak) days in a row." }
        if stats.streak == 1 {
            return stats.studiedToday > 0 ? "You studied today. Come back tomorrow to start a streak." : "You studied yesterday. Study today to keep it going."
        }
        return stats.totals.cards > 0 ? "Grade a few cards today to start a streak." : "Add a deck to get started."
    }

    private func maturityParts(new: Int, learning: Int, young: Int, mature: Int) -> [(String, Int, Color)] {
        [
            ("Learned well", mature, Color(hex: 0x2F55B5)), ("Getting there", young, Color(hex: 0x8FB0E8)),
            ("Learning", learning, Color(hex: 0xB7791F)), ("Not studied yet", new, Color(hex: 0xC9D2DE)),
        ]
    }

    private func heat(_ reviews: Int, _ peak: Int) -> Color {
        guard reviews > 0 else { return Color(hex: 0xE8EDF3) }
        let level = min(4, Int((Double(reviews) / Double(peak) * 4).rounded(.up)))
        return [Color(hex: 0xC7D6F0), Color(hex: 0x8FB0E8), Color(hex: 0x4F74CC), Color(hex: 0x2F55B5)][level - 1]
    }

    private func date(_ day: String) -> Date {
        ISO8601.plain.date(from: "\(day)T12:00:00Z") ?? Date()
    }

    private func shiftDay(_ day: String, _ delta: Int) -> String {
        let shifted = date(day).addingTimeInterval(TimeInterval(delta) * 86_400)
        return String(ISO8601.plain.string(from: shifted).prefix(10))
    }

    private func dayLabel(_ day: String, _ format: Date.FormatStyle) -> String {
        var style = format
        style.timeZone = TimeZone(identifier: "UTC")!
        return date(day).formatted(style)
    }
}

/// A rounded horizontal bar split into colored parts.
struct StackBar: View {
    let parts: [(String, Int, Color)]

    var body: some View {
        let total = max(1, parts.map(\.1).reduce(0, +))
        GeometryReader { geometry in
            HStack(spacing: 0) {
                ForEach(parts.filter { $0.1 > 0 }, id: \.0) { part in
                    part.2.frame(width: geometry.size.width * CGFloat(part.1) / CGFloat(total))
                }
            }
        }
        .frame(height: 12)
        .background(Color(hex: 0xE8EDF3))
        .clipShape(Capsule())
        .accessibilityElement()
        .accessibilityLabel(parts.map { "\($0.0) \($0.1)" }.joined(separator: ", "))
    }
}

struct Legend: View {
    let parts: [(String, Int, Color)]

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), alignment: .leading)], alignment: .leading, spacing: 6) {
            ForEach(parts, id: \.0) { part in
                HStack(spacing: 6) {
                    RoundedRectangle(cornerRadius: 2).fill(part.2).frame(width: 10, height: 10)
                    Text("\(part.0) \(part.1)").font(.caption).foregroundStyle(Color(hex: 0x5B6784))
                }
            }
        }
        .accessibilityHidden(true)
    }
}
