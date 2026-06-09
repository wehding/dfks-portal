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
            onClick={onClick}
            title="Vis i dokument"
            className={`ml-1 inline-flex items-center justify-center w-4 h-4 rounded text-[9px] transition-colors ${
                active
                    ? "bg-yellow-400 text-yellow-900"
                    : "bg-muted text-muted-foreground hover:bg-yellow-200 hover:text-yellow-800"
            }`}
        >
            ¶
        </button>
    )
}
