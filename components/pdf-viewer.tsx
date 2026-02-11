import dynamic from "next/dynamic"

export const PdfViewer = dynamic(
    () => import("@/components/pdf-viewer-inner"),
    {
        ssr: false,
        loading: () => (
            <div className="flex items-center justify-center py-24">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
            </div>
        ),
    }
)
