import AppKit
import SwiftUI
import ScreenCaptureKit
import ImageIO
import UniformTypeIdentifiers

// swiftc -parse-as-library Reference.swift -o GlassReference
// GlassReference background.png output-directory [regular|clear] [light|dark]
// Both shapes are centred at (80,80) and (212,80) in a 328 by 160 point window.
struct Chart: View {
    let background: NSImage
    let material: Glass
    let showGlass: Bool
    let shift: CGFloat

    var body: some View {
        ZStack(alignment: .topLeading) {
            Image(nsImage: background).resizable().interpolation(.none)
                .frame(width: 344, height: 160).offset(x: shift - 8)
            if showGlass {
                Color.clear.frame(width: 60, height: 60)
                    .glassEffect(material.interactive(), in: Circle())
                    .position(x: 80, y: 80)
                Color.clear.frame(width: 140, height: 48)
                    .glassEffect(material.interactive(), in: Capsule())
                    .position(x: 212, y: 80)
            }
        }.frame(width: 328, height: 160, alignment: .topLeading).clipped()
    }
}

@main
struct Reference {
    @MainActor static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let args = CommandLine.arguments
        guard args.count >= 3, let bg = NSImage(contentsOfFile: args[1]) else {
            fputs("Pass a background image and an output directory.\n", stderr)
            exit(2)
        }
        let folder = URL(fileURLWithPath: args[2], isDirectory: true)
        let material: Glass = args.count > 3 && args[3] == "clear" ? .clear : .regular
        let window = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 328, height: 160), styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.hasShadow = false
        window.appearance = NSAppearance(named: args.count > 4 && args[4] == "dark" ? .darkAqua : .aqua)
        let host = NSHostingView(rootView: Chart(background: bg, material: material, showGlass: false, shift: 0))
        window.contentView = host
        window.orderFrontRegardless()
        Task { @MainActor in
            do {
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                try await Task.sleep(for: .milliseconds(450))
                // Only enumerate and capture the window owned by this process.
                let own = try await SCShareableContent.currentProcess
                guard let source = own.windows.first(where: { $0.windowID == CGWindowID(window.windowNumber) }) else {
                    throw NSError(domain: "GlassReference", code: 1, userInfo: [NSLocalizedDescriptionKey: "The compositor did not offer this process its reference window."])
                }
                let filter = SCContentFilter(desktopIndependentWindow: source)
                let config = SCStreamConfiguration()
                let scale = window.backingScaleFactor
                config.width = Int(328 * scale)
                config.height = Int(160 * scale)
                config.showsCursor = false
                config.ignoreShadowsSingleWindow = true
                print("Native backing scale \(scale), window \(config.width)x\(config.height)")
                for (name, visible, shift) in [("background", false, 0.0), ("rest", true, 0.0), ("moved", true, 6.0)] {
                    host.rootView = Chart(background: bg, material: material, showGlass: visible, shift: shift)
                    try await Task.sleep(for: .milliseconds(450))
                    let image: CGImage
                    do {
                        image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
                    } catch {
                        print("ScreenCaptureKit returned \(error); testing window-only screencapture, preflight \(CGPreflightScreenCaptureAccess()).")
                        let shot = Process()
                        shot.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
                        let path = folder.appendingPathComponent(name + "-window.png")
                        shot.arguments = ["-x", "-o", "-l", String(window.windowNumber), path.path]
                        try shot.run()
                        shot.waitUntilExit()
                        if shot.terminationStatus == 0, let src = CGImageSourceCreateWithURL(path as CFURL, nil), let cg = CGImageSourceCreateImageAtIndex(src, 0, nil) {
                            image = cg
                        } else {
                            throw NSError(domain: "GlassReference", code: 2, userInfo: [NSLocalizedDescriptionKey: "Both compositor capture routes failed for this process’s window."])
                        }
                    }
                    let url = folder.appendingPathComponent(name + ".png")
                    guard let dst = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { throw CocoaError(.fileWriteUnknown) }
                    CGImageDestinationAddImage(dst, image, nil)
                    guard CGImageDestinationFinalize(dst) else { throw CocoaError(.fileWriteUnknown) }
                }
                window.orderOut(nil)
                exit(0)
            } catch {
                fputs("Native capture failed: \(error)\n", stderr)
                exit(1)
            }
        }
        app.run()
    }
}
