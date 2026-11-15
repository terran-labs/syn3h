import Foundation
import AppKit
import Vision
// Platform decoder provides an independent scan check for the rendered QR screenshot.
let path = CommandLine.arguments[1]
guard let image = NSImage(contentsOfFile: path), let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { fatalError("Cannot read QR image") }
let request = VNDetectBarcodesRequest()
request.symbologies = [.qr]
try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
let values = request.results?.compactMap { $0.payloadStringValue } ?? []
if values.isEmpty { fatalError("QR did not decode") }
for value in values { print(value) }
