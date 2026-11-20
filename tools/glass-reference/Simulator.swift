import SwiftUI
import UIKit

// A real SwiftUI material in the simulator compositor. The reference image is
// bundled only with this development harness. The game never requests it.
@main struct GlassReferenceApp: App {
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
                        face("Tag").frame(width: 60, height: 60)
                            .glassEffect(glass.interactive(), in: Circle())
                            .position(x: 80, y: 80)
                        face("Show panels").frame(width: 140, height: 48)
                            .glassEffect(glass.interactive(), in: Capsule())
                            .position(x: 212, y: 80)
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
