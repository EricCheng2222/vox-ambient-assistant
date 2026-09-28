import SwiftUI

/// A textbook-style lesson that teaches one topic of a deck, as a few slides.
/// Lessons download with their deck, so they work offline. Shown on iPad.
struct Lesson: Codable, Identifiable, Hashable {
    let id: String
    let deckId: String
    let title: String
    let summary: String?
    let position: Int
    let slides: [Slide]

    struct Slide: Codable, Hashable {
        let kind: String
        let title: String?
        let body: String?
        let items: [String]?
        let columns: [String]?
        let rows: [[String]]?
    }
}

enum LessonsAvailability {
    /// Lessons are an iPad feature for now.
    static var enabled: Bool { UIDevice.current.userInterfaceIdiom == .pad }
}

// MARK: Reading a lesson

struct LessonView: View {
    let lesson: Lesson
    let deckTitle: String
    var cardCount: Int = 0
    @Environment(\.dismiss) private var dismiss
    @State private var page = 0

    var body: some View {
        ZStack {
            Palette.desk.ignoresSafeArea()
            VStack(spacing: 18) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(deckTitle).font(.subheadline).foregroundStyle(Palette.inkSoft)
                        Text(lesson.title).font(.cardFace(30).weight(.semibold)).foregroundStyle(Palette.heading)
                    }
                    Spacer()
                    Button("Done") { dismiss() }.font(.headline).keyboardShortcut(.cancelAction)
                }
                TabView(selection: $page) {
                    ForEach(Array(lesson.slides.enumerated()), id: \.offset) { index, slide in
                        // A slide keeps index-card proportions instead of filling the screen.
                        SlideCard(slide: slide, number: index + 1, total: lesson.slides.count)
                            .frame(maxHeight: 620)
                            .frame(maxHeight: .infinity)
                            .padding(.horizontal, 4)
                            .padding(.bottom, 44)
                            .tag(index)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .always))
                .indexViewStyle(.page(backgroundDisplayMode: .always))
                HStack {
                    Button {
                        withAnimation { page = max(0, page - 1) }
                    } label: {
                        Label("Previous", systemImage: "chevron.left")
                    }
                    .disabled(page == 0)
                    .keyboardShortcut(.leftArrow, modifiers: [])
                    Spacer()
                    if cardCount > 0 {
                        Text("\(cardCount) cards use this lesson").font(.footnote).foregroundStyle(Palette.inkSoft)
                    }
                    Spacer()
                    Button {
                        withAnimation { page = min(lesson.slides.count - 1, page + 1) }
                    } label: {
                        Label("Next", systemImage: "chevron.right").labelStyle(.titleAndIcon)
                    }
                    .disabled(page >= lesson.slides.count - 1)
                    .keyboardShortcut(.rightArrow, modifiers: [])
                }
                .font(.headline)
            }
            .frame(maxWidth: 860)
            .padding(28)
        }
    }
}

struct SlideCard: View {
    let slide: Lesson.Slide
    let number: Int
    let total: Int

    var body: some View {
        IndexCard(topLeft: slide.title ?? "", topRight: "\(number) of \(total)") {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    content
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 28)
                .padding(.vertical, 26)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch slide.kind {
        case "idea", "summary":
            if let body = slide.body {
                Text(body)
                    .font(.cardFace(slide.kind == "summary" ? 26 : 23))
                    .foregroundStyle(Palette.ink)
                    .lineSpacing(6)
            }
        case "steps":
            ForEach(Array((slide.items ?? []).enumerated()), id: \.offset) { index, item in
                HStack(alignment: .firstTextBaseline, spacing: 14) {
                    Text("\(index + 1)")
                        .font(.headline)
                        .foregroundStyle(.white)
                        .frame(width: 28, height: 28)
                        .background(Color(hex: 0x2F55B5), in: Circle())
                    Text(item).font(.cardFace(20)).foregroundStyle(Palette.ink)
                }
            }
        case "table":
            LessonTable(columns: slide.columns ?? [], rows: slide.rows ?? [])
        case "traps":
            ForEach(slide.items ?? [], id: \.self) { item in
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Palette.grade(.hard))
                    Text(item).font(.cardFace(20)).foregroundStyle(Palette.ink)
                }
            }
        default:
            if let body = slide.body {
                Text(body).font(.cardFace(21)).foregroundStyle(Palette.ink)
            }
            ForEach(slide.items ?? [], id: \.self) { item in
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Circle().fill(Palette.margin).frame(width: 7, height: 7).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 2 }
                    Text(item).font(.cardFace(20)).foregroundStyle(Palette.ink)
                }
            }
        }
    }
}

struct LessonTable: View {
    let columns: [String]
    let rows: [[String]]

    var body: some View {
        Grid(alignment: .topLeading, horizontalSpacing: 18, verticalSpacing: 12) {
            GridRow {
                ForEach(Array(columns.enumerated()), id: \.offset) { _, column in
                    Text(column).font(.subheadline.weight(.semibold)).foregroundStyle(Color(hex: 0x2F55B5))
                }
            }
            Divider().gridCellUnsizedAxes(.horizontal)
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                GridRow {
                    ForEach(Array(row.enumerated()), id: \.offset) { index, cell in
                        Text(cell)
                            .font(index == 0 ? .body.weight(.semibold) : .cardFace(18))
                            .foregroundStyle(Palette.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }
}

// MARK: A deck's lessons

struct LessonListView: View {
    let entry: DownloadedDeck
    @State private var open: Lesson?

    private var lessons: [Lesson] { (entry.lessons ?? []).sorted { $0.position < $1.position } }

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 18)], spacing: 18) {
                ForEach(lessons) { lesson in
                    Button { open = lesson } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Lesson \(lesson.position + 1)").font(.caption).foregroundStyle(Palette.faint)
                            Text(lesson.title).font(.cardFace(21)).foregroundStyle(Palette.ink).multilineTextAlignment(.leading)
                            if let summary = lesson.summary {
                                Text(summary).font(.subheadline).foregroundStyle(Color(hex: 0x5B6784)).multilineTextAlignment(.leading)
                            }
                            Text("\(entry.cards.filter { $0.lessonId == lesson.id }.count) cards")
                                .font(.footnote)
                                .foregroundStyle(Palette.faint)
                        }
                        .frame(maxWidth: .infinity, minHeight: 120, alignment: .topLeading)
                        .padding(18)
                        .background {
                            ZStack(alignment: .top) {
                                Palette.paper
                                Palette.margin.frame(height: 2).padding(.top, 10)
                            }
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .shadow(color: Palette.ink.opacity(0.1), radius: 8, y: 4)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(28)
        }
        .background(Palette.desk.ignoresSafeArea())
        .navigationTitle("\(entry.deck.title) lessons")
        .fullScreenCover(item: $open) { lesson in
            LessonView(
                lesson: lesson,
                deckTitle: entry.deck.title,
                cardCount: entry.cards.filter { $0.lessonId == lesson.id }.count
            )
        }
    }
}
