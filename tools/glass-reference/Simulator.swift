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

    var body: some Scene {
        WindowGroup {
            let name = option("-background", "grid")
            let shift = CGFloat(Double(option("-shift", "0")) ?? 0)
            let glass: Glass = option("-variant", "regular") == "clear" ? .clear : .regular
            ZStack {
                Color(white: option("-theme", "light") == "dark" ? 0.08 : 0.94)
                ZStack(alignment: .topLeading) {
                    if let file = Bundle.main.url(forResource: name, withExtension: "png"), let image = UIImage(contentsOfFile: file.path) {
                        Image(uiImage: image).resizable().interpolation(.none)
                            .frame(width: 344, height: 160).offset(x: shift - 8)
                    }
                    if !args.contains("-bare") {
                        if args.contains("-motion") {
                            // The gesture moves the control with the finger. SwiftUI
                            // alone draws its pressed surface and the joined shape.
                            GlassEffectContainer(spacing: 18) {
                                ZStack(alignment: .topLeading) {
                                    motionFace("Tag", width: 60, height: 60, shape: Circle(), border: .circle, glass: glass)
                                        .contentShape(Circle())
                                        .simultaneousGesture(DragGesture(minimumDistance: 0, coordinateSpace: .global)
                                            .onChanged { drag in contact = 1; dragX = drag.translation.width }
                                            .onEnded { _ in contact = 0; dragX = 0 })
                                        .position(x: 80 + dragX, y: 80)
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
            .ignoresSafeArea()
            .statusBarHidden(true)
            .persistentSystemOverlays(.hidden)
            .preferredColorScheme(option("-theme", "light") == "dark" ? .dark : .light)
        }
    }
}
