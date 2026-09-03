export interface LegalNoteContextRow {
    title: string
    body: string
    exclude_for_overenskomst?: string[] | null
}

export function filterLegalNotesForContract(
    notes: LegalNoteContextRow[],
    isAgreementContract: boolean,
    detectedAgreements: string[] = []
): Array<{ title: string; body: string }> {
    if (!isAgreementContract) {
        return notes.map(({ title, body }) => ({ title, body }))
    }

    const detected = new Set(detectedAgreements.map(value => value.toLowerCase()))

    return notes
        .filter(note => {
            const exclusions = (note.exclude_for_overenskomst ?? []).map(value => value.toLowerCase())
            return !exclusions.includes("alle") && !exclusions.some(value => detected.has(value))
        })
        .map(({ title, body }) => ({ title, body }))
}
