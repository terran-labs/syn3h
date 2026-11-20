# Material attribution

The Regular shader adapts the two-scale backdrop and asymmetric detail transfer from Shayan's Liquid Glass Skia material. The original project distributes its shader and authored source-map code under Apache License 2.0. Its NOTICE describes separate rights for screenshots and other reference assets. No upstream image, capture, measured landmark table, CanvasKit runtime or SkSL binary is included. The displacement and neutral response here come from new SwiftUI simulator captures at the Syn3h control sizes. [Upstream revision](https://github.com/shayann07/liquidglass/tree/9effb52bcb9d36e8048666b935f9d4ac46b99b47/ports/skia)

The relevant changes are the TypeScript Shading Language port, inline backdrop sampling and local calibration. See the accompanying Apache licence and original NOTICE in `licenses/`.
