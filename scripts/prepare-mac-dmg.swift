import AppKit

// Finder icon coordinates in package.json use the same 820 × 650 point canvas.
// Include both resolutions in the TIFF so text stays sharp on Retina displays.
let destination = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "resources/macos", isDirectory: true)
try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
let width = 820.0, height = 650.0
func color(_ hex: UInt32, alpha: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255,
            green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255, alpha: alpha)
}
let ink = color(0x30283F), muted = color(0x756D82), accent = color(0x7856B2)
func text(_ value: String, x: CGFloat, y: CGFloat, w: CGFloat, size: CGFloat,
          weight: NSFont.Weight = .regular, fill: NSColor = ink) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineBreakMode = .byWordWrapping
    paragraph.lineSpacing = 3
    (value as NSString).draw(in: NSRect(x: x, y: y, width: w, height: 60), withAttributes: [
        .font: NSFont.systemFont(ofSize: size, weight: weight),
        .foregroundColor: fill, .paragraphStyle: paragraph
    ])
}
func tile(_ rect: NSRect, radius: CGFloat, fill: NSColor, stroke: NSColor? = nil) {
    let path = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
    fill.setFill(); path.fill()
    if let stroke { stroke.setStroke(); path.lineWidth = 1; path.stroke() }
}
func render(scale: CGFloat) -> NSBitmapImageRep {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(width * scale),
        pixelsHigh: Int(height * scale), bitsPerSample: 8, samplesPerPixel: 4,
        hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    bitmap.size = NSSize(width: width, height: height)
    let cg = NSGraphicsContext(bitmapImageRep: bitmap)!.cgContext
    // NSGraphicsContext already scales bitmap pixels to bitmap.size points.
    cg.translateBy(x: 0, y: height)
    cg.scaleBy(x: 1, y: -1)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: cg, flipped: true)
    color(0xFAF8FD).setFill()
    NSBezierPath(rect: NSRect(x: 0, y: 0, width: width, height: height)).fill()

    // Brand mark is drawn as vectors; the actual application icons are Finder items.
    tile(NSRect(x: 44, y: 30, width: 30, height: 30), radius: 9, fill: accent)
    for (i, h) in [9.0, 16.0, 22.0, 14.0, 7.0].enumerated() {
        tile(NSRect(x: 51 + Double(i) * 4, y: 45 - h / 2, width: 2.5, height: h), radius: 1.2, fill: .white)
    }
    text("声悦", x: 84, y: 28, w: 150, size: 25, weight: .semibold)
    text("macOS · 本地配音工作台", x: 592, y: 38, w: 190, size: 13, fill: muted)
    text("好声音，让表达更动人", x: 44, y: 85, w: 700, size: 32, weight: .semibold)
    text("将左侧「声悦」拖入右侧 Applications，再从“应用程序”打开。",
         x: 44, y: 137, w: 740, size: 16, fill: muted)

    for x: CGFloat in [200, 620] {
        tile(NSRect(x: x - 78, y: 184, width: 156, height: 152), radius: 26,
             fill: .white, stroke: color(0xE8E0F2))
    }
    for (i, h) in [9.0, 15.0, 23.0, 34.0, 46.0, 58.0, 45.0, 31.0, 20.0, 12.0, 7.0].enumerated() {
        tile(NSRect(x: 348 + Double(i) * 9, y: 248 - h / 2, width: 4, height: h),
             radius: 2, fill: color(0xB69ACF))
    }
    let arrow = NSBezierPath()
    arrow.move(to: NSPoint(x: 466, y: 237))
    arrow.line(to: NSPoint(x: 478, y: 248))
    arrow.line(to: NSPoint(x: 466, y: 259))
    arrow.lineWidth = 3; arrow.lineCapStyle = .round; arrow.lineJoinStyle = .round
    accent.setStroke(); arrow.stroke()

    tile(NSRect(x: 44, y: 373, width: 732, height: 218), radius: 20,
         fill: .white, stroke: color(0xE5DCEE))
    tile(NSRect(x: 62, y: 410, width: 116, height: 146), radius: 14, fill: color(0xF4F0F9))
    text("首次打开被系统拦截？", x: 222, y: 393, w: 520, size: 20, weight: .semibold)
    let steps = [
        "先从“应用程序”尝试打开一次「声悦」。",
        "进入 系统设置 → 隐私与安全性。",
        "找到“声悦”提示，点「仍要打开」，再确认「打开」。"
    ]
    for (i, step) in steps.enumerated() {
        let y = CGFloat(436 + i * 32)
        tile(NSRect(x: 222, y: y, width: 22, height: 22), radius: 11, fill: color(0xEEE7F7))
        text(String(i + 1), x: 229, y: y + 2, w: 18, size: 13, weight: .semibold, fill: accent)
        text(step, x: 256, y: y + 1, w: 500, size: 14)
    }
    text("左侧详细说明可离线阅读，附 Apple 官方操作链接。",
         x: 222, y: 550, w: 520, size: 12, fill: muted)
    text("macOS 14 或更高版本 · 首次配音需在软件内准备声音资源",
         x: 44, y: 598, w: 730, size: 11, fill: muted)
    NSGraphicsContext.restoreGraphicsState()
    return bitmap
}
let normal = render(scale: 1), retina = render(scale: 2)
try normal.representation(using: .png, properties: [:])!.write(to: destination.appendingPathComponent("dmg-background.png"))
try retina.representation(using: .png, properties: [:])!.write(to: destination.appendingPathComponent("dmg-background@2x.png"))
let tiff = Process()
tiff.executableURL = URL(fileURLWithPath: "/usr/bin/tiffutil")
tiff.arguments = ["-cathidpicheck", destination.appendingPathComponent("dmg-background.png").path,
    destination.appendingPathComponent("dmg-background@2x.png").path,
    "-out", destination.appendingPathComponent("dmg-background.tiff").path]
try tiff.run()
tiff.waitUntilExit()
guard tiff.terminationStatus == 0 else { fatalError("无法生成 Retina DMG 背景") }
print("DMG 背景已生成：820 × 650，含 Retina 分辨率。")
