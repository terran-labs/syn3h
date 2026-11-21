import SwiftUI
import UIKit

// A real SwiftUI material in the simulator compositor. The reference image is
// bundled only with this development harness. The game never requests it.
@main struct GlassReferenceApp: App {
    @State private var dragX: CGFloat = 0
    @State private var contact = 0
    let args = ProcessInfo.processInfo.arguments
    func option(_ key: String, _ fallback: String) -> String {
        guard let i = args.firstIndex(of: key), args.indices.contains(i + 1) else { return fallback }
        return args[i + 1]
    }
    @ViewBuilder
    func face(_ title: String) -> some View {
        if args.contains("-labels") {
            Text(title).font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
        } else {
            Color.clear
        }
    }

    @ViewBuilder
    func motionFace<S: InsettableShape>(_ title: String, width: CGFloat, height: CGFloat,
                                         shape: S, border: ButtonBorderShape, glass: Glass) -> some View {
        if args.contains("-native-buttons") {
            Button(title) {}
                .buttonStyle(.glass)
                .buttonBorderShape(border)
                .buttonSizing(.flexible)
                .frame(width: width, height: height)
        } else {
            face(title).frame(width: width, height: height)
                .glassEffect(glass.interactive(), in: shape)
        }
    }

    func pairButton(_ title: String, diameter: CGFloat) -> some View {
        let labelSize = max(1, diameter - CGFloat(Double(option("-inset", "14")) ?? 14))
        return Button {
        } label: {
            Text(title).font(.system(size: 10, weight: .semibold))
                .frame(width: labelSize, height: labelSize)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .accessibilityLabel(title)
        .simultaneousGesture(DragGesture(minimumDistance: 0)
            .onChanged { _ in contact = 1 }
            .onEnded { _ in contact = 0 })
    }

    // A card-size neutral field separates ink, backdrop transmission and
    // selection fill. A second capture without text gives the local background.
    @ViewBuilder
    func panelReference(_ glass: Glass) -> some View {
        ZStack {
            let field = option("-field", "white")
            if let path = Bundle.main.url(forResource: field, withExtension: "png"), let source = UIImage(contentsOfFile: path.path) {
                Image(uiImage: source).resizable().interpolation(.none).frame(width: 390, height: 844)
            } else {
                Color(white: field == "white" ? 1 : CGFloat(Double(field) ?? 0) / 255)
            }
            VStack(alignment: .leading, spacing: 24) {
                if !args.contains("-bare-ink") {
                    Text("Player name").foregroundStyle(.primary)
                    Text("Focus display").foregroundStyle(.secondary)
                    Picker("Units", selection: .constant(0)) {
                        Text("Metric").tag(0)
                        Text("Imperial").tag(1)
                    }.pickerStyle(.segmented)
                }
                Spacer()
            }
            .font(.body)
            .padding(20)
            .frame(width: 342, height: 741, alignment: .topLeading)
            .glassEffect(glass, in: .rect(cornerRadius: 16))
        }
    }

    var body: some Scene {
        WindowGroup {
            let name = option("-background", "grid")
            let shift = CGFloat(Double(option("-shift", "0")) ?? 0)
            let glass: Glass = option("-variant", "regular") == "clear" ? .clear : .regular
            ZStack {
                if args.contains("-panel") {
                    panelReference(glass)
                } else {
                Color(white: option("-theme", "light") == "dark" ? 0.08 : 0.94)
                ZStack(alignment: .topLeading) {
                    if let file = Bundle.main.url(forResource: name, withExtension: "png"), let image = UIImage(contentsOfFile: file.path) {
                        Image(uiImage: image).resizable().interpolation(.none)
                            .frame(width: 344, height: 160).offset(x: shift - 8)
                    }
                    if !args.contains("-bare") {
                        if args.contains("-button-pair") {
                            let diameter = CGFloat(Double(option("-diameter", "56")) ?? 56)
                            let gap = CGFloat(Double(option("-gap", "8")) ?? 8)
                            GlassEffectContainer(spacing: 18) {
                                ZStack(alignment: .topLeading) {
                                    pairButton("Zorb", diameter: diameter).position(x: 110, y: 80)
                                    pairButton("Brake", diameter: diameter).position(x: 110 + diameter + gap, y: 80)
                                }
                            }
                            Rectangle().fill(contact == 1 ? Color.red : Color.black)
                                .frame(width: 5, height: 5).allowsHitTesting(false)
                        } else if args.contains("-motion") {
                            // The gesture moves the control with the finger. SwiftUI
                            // alone draws its pressed surface and the joined shape.
                            GlassEffectContainer(spacing: 18) {
                                ZStack(alignment: .topLeading) {
                                    motionFace("Tag", width: 60, height: 60, shape: Circle(), border: .circle, glass: glass)
                                        .contentShape(Circle())
                                        .simultaneousGesture(DragGesture(minimumDistance: 0, coordinateSpace: .global)
                                            .onChanged { drag in contact = 1; dragX = drag.translation.width }
                                            .onEnded { _ in contact = 0; dragX = 0 })
                                        .position(x: 112 - CGFloat(Double(option("-gap", "32")) ?? 32) + dragX, y: 80)
                                    motionFace("Show panels", width: 140, height: 48, shape: Capsule(), border: .capsule, glass: glass)
                                        .contentShape(Capsule())
                                        .simultaneousGesture(DragGesture(minimumDistance: 0)
                                            .onChanged { _ in contact = 2 }
                                            .onEnded { _ in contact = 0 })
                                        .position(x: 212, y: 80)
                                }
                            }
                            // A marker outside both controls identifies actual contact
                            // frames in the simulator recording.
                            Rectangle().fill(contact == 1 ? Color.red : contact == 2 ? Color.green : Color.black)
                                .frame(width: 5, height: 5).allowsHitTesting(false)
                        } else {
                            face("Tag").frame(width: 60, height: 60)
                                .glassEffect(glass.interactive(), in: Circle())
                                .position(x: 80, y: 80)
                            face("Show panels").frame(width: 140, height: 48)
                                .glassEffect(glass.interactive(), in: Capsule())
                                .position(x: 212, y: 80)
                        }
                    }
                }.frame(width: 328, height: 160, alignment: .topLeading).clipped()
                }
            }
            .ignoresSafeArea()
            .statusBarHidden(true)
            .persistentSystemOverlays(.hidden)
            .preferredColorScheme(option("-theme", "light") == "dark" ? .dark : .light)
        }
    }
}
