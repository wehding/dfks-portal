import Foundation
import Vision
import ImageIO

struct PageResult: Codable {
    let file: String
    let text: String
}

func recognize(path: String) throws -> String {
    let url = URL(fileURLWithPath: path)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw NSError(domain: "DFKSArchiveOCR", code: 1, userInfo: [NSLocalizedDescriptionKey: "JPG-filen kunne ikke åbnes"])
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["da-DK", "en-GB"]
    request.usesLanguageCorrection = true
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    let observations = request.results ?? []
    return observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

let paths = Array(CommandLine.arguments.dropFirst())
guard !paths.isEmpty else {
    FileHandle.standardError.write(Data("Angiv mindst én JPG-fil\n".utf8))
    exit(2)
}

do {
    let pages = try paths.map { path in PageResult(file: URL(fileURLWithPath: path).lastPathComponent, text: try recognize(path: path)) }
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    FileHandle.standardOutput.write(try encoder.encode(pages))
} catch {
    FileHandle.standardError.write(Data("OCR-fejl: \(error.localizedDescription)\n".utf8))
    exit(1)
}
