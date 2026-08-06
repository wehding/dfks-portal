export function detectAgreementReferences(text: string): string[] {
    const references: string[] = []
    if (/\bde[\s-]?4\b|de4.{0,10}overenskomst/i.test(text)) references.push("de4")
    if (/\bfaf\b.*?(dokumentar|dok)/i.test(text)) references.push("faf-dokumentar")
    else if (/\bfaf\b|faf.{0,10}overenskomst/i.test(text)) references.push("faf")
    if (/\b(dj|dansk journalistforbund)\b.{0,40}(tv|overenskomst)|tv.{0,40}\b(dj|dansk journalistforbund)\b/i.test(text)) references.push("dj-tv")
    if (/\b(dr|danmarks radio)\b.{0,60}\b(dansk metal|metal)\b|\b(dansk metal|metal)\b.{0,60}\b(dr|danmarks radio)\b/i.test(text)) references.push("dr-metal")
    if (/create[\s-]?denmark/i.test(text) && !references.length) references.push("de4")
    return [...new Set(references)]
}
