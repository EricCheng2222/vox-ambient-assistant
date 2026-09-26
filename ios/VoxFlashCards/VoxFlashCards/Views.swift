import SwiftUI

// Index cards on a desk, matching the Vox Flash Cards website.
enum Palette {
    static let desk = Color(light: 0xE3E8EE, dark: 0x172233)
    static let paper = Color(light: 0xFFFFFF, dark: 0xEEF0EC)
    static let rule = Color(hex: 0xCFE0F2)
    static let margin = Color(hex: 0xDB4B3F)
    static let ink = Color(hex: 0x1E2B45)
    static let inkSoft = Color(light: 0x55617A, dark: 0xB9C3D4)
    static let heading = Color(light: 0x1E2B45, dark: 0xF1F3F7)
    static let faint = Color(hex: 0x8A94A8)
    static let action = Color(light: 0x2F55B5, dark: 0x8FB0FF)
    static let actionInk = Color(light: 0xFFFFFF, dark: 0x0F1A33)

    static func grade(_ rating: Rating) -> Color {
        switch rating {
        case .again: return Color(hex: 0xC8453A)
        case .hard: return Color(hex: 0xB7791F)
        case .good: return Color(hex: 0x2F7D4F)
        case .easy: return Color(hex: 0x2F55B5)
        }
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }

    init(light: UInt32, dark: UInt32) {
        self.init(UIColor { $0.userInterfaceStyle == .dark ? UIColor(Color(hex: dark)) : UIColor(Color(hex: light)) })
    }
}

extension Font {
    /// The card face: a bookish serif that suits handwriting-on-paper cards.
    static func cardFace(_ size: CGFloat) -> Font { .system(size: size, weight: .regular, design: .serif) }
}

/// A ruled index card with the red line near the top.
struct IndexCard<Content: View>: View {
    var topLeft: String = ""
    var topRight: String = ""
    @ViewBuilder var content: Content

    var body: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Palette.paper)
                .shadow(color: Palette.ink.opacity(0.14), radius: 12, y: 6)
            Canvas { context, size in
                var y: CGFloat = 78
                while y < size.height - 4 {
                    context.fill(Path(CGRect(x: 0, y: y, width: size.width, height: 1)), with: .color(Palette.rule))
                    y += 34
                }
                context.fill(Path(CGRect(x: 0, y: 44, width: size.width, height: 2)), with: .color(Palette.margin))
            }
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            HStack {
                Text(topLeft).lineLimit(1)
                Spacer(minLength: 12)
                Text(topRight)
            }
            .font(.footnote)
            .foregroundStyle(Palette.faint)
            .padding(.horizontal, 20)
            .padding(.top, 14)
            content.padding(.top, 50)
        }
    }
}

// MARK: Root

struct RootView: View {
    @EnvironmentObject private var auth: AuthManager
    @EnvironmentObject private var library: Library
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if auth.isSignedIn || !library.downloaded.isEmpty {
                LibraryView()
            } else {
                SignInView()
            }
        }
        .tint(Palette.action)
        .onChange(of: scenePhase) { phase in
            if phase == .active { Task { await library.sync() } }
        }
        // While open, pick up reviews and edits made in Vox, ChatGPT, or the website.
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                if Task.isCancelled { break }
                await library.refreshChanges()
            }
        }
        .onChange(of: auth.isSignedIn) { signedIn in
            if signedIn { Task { await library.sync() } }
        }
    }
}

// MARK: Sign in

struct SignInView: View {
    @EnvironmentObject private var auth: AuthManager
    @State private var error: String?
    @State private var flipped = false

    var body: some View {
        ZStack {
            Palette.desk.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 24) {
                Spacer()
                Text("Flash cards that\ngo where you go.")
                    .font(.cardFace(36).weight(.semibold))
                    .foregroundStyle(Palette.heading)
                Text("Download your decks from Vox Flash Cards and study anywhere, even with no signal. Your progress syncs when you’re back online.")
                    .font(.body)
                    .foregroundStyle(Palette.inkSoft)
                IndexCard(topLeft: "Biochemistry", topRight: flipped ? "Answer" : "Question") {
                    Text(flipped ? "In the cytosol." : "Where in the cell does glycolysis happen?")
                        .font(.cardFace(22))
                        .foregroundStyle(Palette.ink)
                        .padding(.horizontal, 20)
                        .padding(.top, 34)
                }
                .frame(height: 190)
                .rotation3DEffect(.degrees(flipped ? 360 : 0), axis: (x: 0, y: 1, z: 0))
                .onTapGesture { withAnimation(.easeInOut(duration: 0.5)) { flipped.toggle() } }
                .accessibilityAddTraits(.isButton)
                .accessibilityHint("Flips the sample card")
                Spacer()
                if let error {
                    Text(error).font(.footnote).foregroundStyle(Palette.grade(.again))
                }
                Button {
                    Task {
                        error = nil
                        do { try await auth.signIn() } catch is CancellationError {} catch { self.error = error.localizedDescription }
                    }
                } label: {
                    HStack {
                        if auth.isSigningIn { ProgressView().tint(Palette.actionInk) }
                        Text("Sign in with Vox")
                    }
                    .font(.headline)
                    .frame(maxWidth: .infinity, minHeight: 54)
                    .foregroundStyle(Palette.actionInk)
                    .background(Palette.action, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .disabled(auth.isSigningIn)
            }
            .padding(24)
        }
    }
}

// MARK: Library

struct LibraryView: View {
    @EnvironmentObject private var auth: AuthManager
    @EnvironmentObject private var library: Library
    @State private var studying: StudyScope?
    @State private var confirmSignOut = false
    @State private var signInError: String?

    private var dueTotal: Int { library.dueCards(in: nil).count }
    private var notDownloaded: [Deck] { library.remoteDecks.filter { library.downloaded[$0.id] == nil } }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    todayCard
                    if !library.downloadedDecks.isEmpty { downloadedSection }
                    if !notDownloaded.isEmpty { accountSection }
                    if library.remoteDecks.isEmpty && library.downloaded.isEmpty && library.syncState != .syncing {
                        Text("No decks yet. Make one on the Vox Flash Cards website, then pull down here to refresh.")
                            .foregroundStyle(Palette.inkSoft)
                    }
                    syncFooter
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
            .refreshable { await library.sync() }
            .background(Palette.desk.ignoresSafeArea())
            .navigationTitle("Flash Cards")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if !auth.userName.isEmpty { Text("Signed in as \(auth.userName)") }
                        Link("Open the website", destination: AppConfig.siteURL)
                        Button("Sign out", role: .destructive) { confirmSignOut = true }
                    } label: {
                        Image(systemName: "person.crop.circle").accessibilityLabel("Account")
                    }
                }
            }
            .confirmationDialog(
                library.pending.isEmpty
                    ? "Sign out and remove downloaded decks from this iPhone?"
                    : "\(library.pending.count) grades haven’t synced yet and will be lost. Sign out anyway?",
                isPresented: $confirmSignOut,
                titleVisibility: .visible
            ) {
                Button("Sign out", role: .destructive) {
                    library.erase()
                    auth.signOut()
                }
            }
            .fullScreenCover(item: $studying) { scope in
                StudyView(scope: scope)
            }
        }
    }

    private var todayCard: some View {
        IndexCard(topLeft: "Today", topRight: library.downloaded.isEmpty ? "" : "\(library.downloaded.count) downloaded") {
            VStack(alignment: .leading, spacing: 14) {
                if library.downloaded.isEmpty {
                    Text("Download a deck to study it here, online or off.")
                        .font(.cardFace(22))
                        .foregroundStyle(Palette.ink)
                } else {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text("\(dueTotal)").font(.cardFace(52).weight(.semibold)).foregroundStyle(Palette.ink)
                        Text(dueTotal == 1 ? "card to review" : "cards to review").foregroundStyle(Color(hex: 0x55617A))
                    }
                    Button {
                        studying = StudyScope(deckIds: nil, title: "All downloaded decks")
                    } label: {
                        Text(dueTotal > 0 ? "Study now" : "All caught up")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 50)
                            .foregroundStyle(dueTotal > 0 ? .white : Color(hex: 0x55617A))
                            .background(dueTotal > 0 ? Color(hex: 0x2F55B5) : Color(hex: 0xE8EDF3), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .disabled(dueTotal == 0)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 20)
        }
    }

    private var downloadedSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("On this iPhone")
            ForEach(library.downloadedDecks, id: \.deck.id) { entry in
                let due = library.dueCards(in: [entry.deck.id]).count
                Button {
                    studying = StudyScope(deckIds: [entry.deck.id], title: entry.deck.title)
                } label: {
                    DeckRow(deck: entry.deck, detail: "\(entry.cards.count) cards", due: due, trailing: AnyView(
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.grade(.good)).accessibilityLabel("Downloaded")
                    ))
                }
                .buttonStyle(.plain)
                .contextMenu {
                    Button("Remove download", systemImage: "trash", role: .destructive) { library.removeDownload(entry.deck.id) }
                }
            }
        }
    }

    private var accountSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                sectionTitle("In your account")
                Spacer()
                if notDownloaded.count > 1 {
                    Button("Download all") {
                        Task { for deck in notDownloaded { await library.download(deck) } }
                    }
                    .font(.subheadline.weight(.semibold))
                }
            }
            ForEach(notDownloaded) { deck in
                DeckRow(deck: deck, detail: "\(deck.cardCount) cards", due: nil, trailing: AnyView(downloadButton(deck)))
            }
        }
    }

    @ViewBuilder
    private func downloadButton(_ deck: Deck) -> some View {
        if library.downloading.contains(deck.id) {
            ProgressView().tint(Color(hex: 0x2F55B5))
        } else {
            Button {
                Task { await library.download(deck) }
            } label: {
                Image(systemName: "arrow.down.circle").font(.title2).foregroundStyle(Color(hex: 0x2F55B5))
            }
            .accessibilityLabel("Download \(deck.title)")
        }
    }

    private var syncFooter: some View {
        Text(syncText)
            .font(.footnote)
            .foregroundStyle(Palette.inkSoft)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var syncText: String {
        let waiting = library.pending.count
        let queued = waiting == 0 ? "" : " \(waiting) \(waiting == 1 ? "grade" : "grades") will sync when you’re back online."
        switch library.syncState {
        case .syncing: return "Syncing…"
        case .offline: return "Offline. Downloaded decks still work." + queued
        case .failed(let message): return message + queued
        case .idle:
            if !auth.isSignedIn { return "Signed out. Sign in again to sync." }
            guard let last = library.lastSync else { return "Pull down to sync." }
            return "Synced \(last.formatted(.relative(presentation: .named)))." + (waiting > 0 ? " \(waiting) waiting to sync." : "")
        }
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text).font(.headline).foregroundStyle(Palette.heading)
    }
}

struct DeckRow: View {
    let deck: Deck
    let detail: String
    let due: Int?
    let trailing: AnyView

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                if let series = deck.series {
                    Text(series).font(.caption).foregroundStyle(Palette.faint)
                }
                Text(deck.title).font(.cardFace(20)).foregroundStyle(Palette.ink).multilineTextAlignment(.leading)
                HStack(spacing: 6) {
                    Text(detail)
                    if let due, due > 0 { Text("\(due) due").foregroundStyle(Palette.grade(.again)).fontWeight(.semibold) }
                }
                .font(.footnote)
                .foregroundStyle(Color(hex: 0x6B7690))
            }
            Spacer(minLength: 8)
            trailing
        }
        .padding(16)
        .padding(.top, 6)
        .background {
            ZStack(alignment: .top) {
                Palette.paper
                Palette.margin.frame(height: 2).padding(.top, 10)
            }
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .shadow(color: Palette.ink.opacity(0.1), radius: 8, y: 4)
        }
    }
}

// MARK: Study

struct StudyScope: Identifiable {
    let deckIds: Set<String>?
    let title: String
    var id: String { deckIds?.sorted().joined(separator: ",") ?? "all" }
}

struct StudyView: View {
    let scope: StudyScope
    @EnvironmentObject private var library: Library
    @Environment(\.dismiss) private var dismiss
    @State private var card: Card?
    @State private var isRepeat = false
    @State private var flipped = false
    @State private var reviewed = 0
    @State private var now = Date()

    private var due: [Card] { library.dueCards(in: scope.deckIds, at: now) }

    var body: some View {
        ZStack {
            Palette.desk.ignoresSafeArea()
            VStack(spacing: 20) {
                header
                if let card {
                    cardView(card)
                    controls(card)
                } else {
                    doneView
                }
            }
            .padding(20)
        }
        .onAppear(perform: advance)
        // If the card on screen was reviewed or edited elsewhere, keep up.
        .onChange(of: library.downloaded) { _ in
            guard let current = card else { return advance() }
            let fresh = library.downloaded[current.deckId]?.cards.first { $0.id == current.id }
            if let fresh, fresh.dueAt <= Date(), fresh.lastReviewedAt == current.lastReviewedAt {
                if fresh != current { card = fresh }
            } else if !flipped {
                advance()
            }
        }
    }

    private var header: some View {
        HStack {
            Button("Done") { dismiss() }.font(.headline)
            Spacer()
            VStack(spacing: 2) {
                Text(scope.title).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.heading).lineLimit(1)
                Text("\(due.count) due, \(reviewed) reviewed").font(.caption).foregroundStyle(Palette.inkSoft)
            }
            Spacer()
            Color.clear.frame(width: 44, height: 1)
        }
    }

    private func cardView(_ card: Card) -> some View {
        let deckTitle = library.deck(card.deckId)?.title ?? ""
        return ZStack {
            if due.count > 1 {
                RoundedRectangle(cornerRadius: 8).fill(Palette.paper).rotationEffect(.degrees(1.5)).offset(x: 5, y: 7)
                    .shadow(color: Palette.ink.opacity(0.1), radius: 8, y: 4)
            }
            IndexCard(topLeft: deckTitle, topRight: flipped ? "Answer" : (isRepeat ? "Missed earlier, try again" : "Question")) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(flipped ? card.back : card.front)
                            .font(.cardFace((flipped ? card.back : card.front).count > 90 ? 20 : 25))
                            .foregroundStyle(Palette.ink)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if flipped, let notes = card.notes, !notes.isEmpty {
                            Text(notes).font(.cardFace(17)).foregroundStyle(Color(hex: 0x5B6784))
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 24)
                }
            }
            // Mirror the card while it's turned over so the back reads normally.
            .scaleEffect(x: flipped ? -1 : 1, y: 1)
            .rotation3DEffect(.degrees(flipped ? 180 : 0), axis: (x: 0, y: 1, z: 0), perspective: 0.4)
        }
        .frame(maxHeight: 560)
        .frame(maxHeight: .infinity)
        .contentShape(Rectangle())
        .onTapGesture { withAnimation(.easeInOut(duration: 0.45)) { flipped.toggle() } }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityHint(flipped ? "Shows the question" : "Shows the answer")
    }

    @ViewBuilder
    private func controls(_ card: Card) -> some View {
        if flipped {
            HStack(spacing: 8) {
                ForEach(Rating.allCases) { rating in
                    Button {
                        library.grade(card, rating)
                        reviewed += 1
                        advance()
                    } label: {
                        VStack(spacing: 2) {
                            Text(rating.label).font(.headline)
                            Text(rating.hint).font(.caption2).foregroundStyle(Color(hex: 0x6B7690))
                        }
                        .foregroundStyle(Palette.ink)
                        .frame(maxWidth: .infinity, minHeight: 62)
                        .background(Palette.paper, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(alignment: .bottom) {
                            Palette.grade(rating).frame(height: 3).clipShape(RoundedRectangle(cornerRadius: 2))
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .accessibilityLabel("\(rating.label), \(rating.hint)")
                }
            }
        } else {
            HStack(spacing: 10) {
                Button {
                    library.skip(card)
                    advance()
                } label: {
                    Text("Skip")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 54)
                        .foregroundStyle(Palette.inkSoft)
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Palette.inkSoft.opacity(0.4), lineWidth: 1.5))
                }
                Button {
                    withAnimation(.easeInOut(duration: 0.45)) { flipped = true }
                } label: {
                    Text("Show answer")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 54)
                        .foregroundStyle(Palette.actionInk)
                        .background(Palette.action, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }
        }
    }

    private var doneView: some View {
        VStack(spacing: 18) {
            Spacer()
            IndexCard(topLeft: scope.title, topRight: "") {
                VStack(alignment: .leading, spacing: 10) {
                    Text(reviewed > 0 ? "Nice work. You reviewed \(reviewed) \(reviewed == 1 ? "card" : "cards")." : "Nothing due right now.")
                        .font(.cardFace(24))
                        .foregroundStyle(Palette.ink)
                    if let next = library.nextDue(in: scope.deckIds) {
                        Text("Next card comes due \(next.formatted(.relative(presentation: .named))).")
                            .foregroundStyle(Color(hex: 0x55617A))
                    }
                }
                .padding(20)
                .padding(.top, 12)
            }
            .frame(height: 220)
            Button { dismiss() } label: {
                Text("Back to decks")
                    .font(.headline)
                    .frame(maxWidth: .infinity, minHeight: 54)
                    .foregroundStyle(Palette.actionInk)
                    .background(Palette.action, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            Spacer()
        }
    }

    private func advance() {
        now = Date()
        flipped = false
        let next = library.nextCard(in: scope.deckIds, at: now)
        card = next?.card
        isRepeat = next?.isRepeat ?? false
    }
}
