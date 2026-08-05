"use client"

/**
 * components/source-btn.tsx
 *
 * Small ¶ button that appears next to extracted form fields.
 * When clicked it sets activeSource, which triggers PDF/text highlighting
 * in PdfViewer / TextViewer via the activeHighlight prop.
 *
 * Used in: admin/validering, admin/kontrakter (upload dialog)
 */
export function SourceBtn({
    quote,
    active,
    onClick,
}: {
    quote?: string | null
    active: boolean
    onClick: () => void
}) {
    if (!quote) return null
    return (
        <button
            type="button"
            onClick={onClick}
            title="Vis i dokument"
            aria-label="Vis feltets kilde i dokumentet"
            className={`ml-1 hidden h-4 w-4 items-center justify-center rounded text-[9px] transition-colors sm:inline-flex ${
                active
                    ? "bg-yellow-400 text-yellow-900"
                    : "bg-muted text-muted-foreground hover:bg-yellow-200 hover:text-yellow-800"
            }`}
        >
            ¶
        </button>
    )
}
