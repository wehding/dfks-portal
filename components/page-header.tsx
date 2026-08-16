export interface PageHeaderProps {
    title: string
    subtitle?: string
    actions?: React.ReactNode
    hideTitleOnMobile?: boolean
    mobileBreakpoint?: "sm" | "md"
}

export function PageHeader({ title, subtitle, actions, hideTitleOnMobile = true, mobileBreakpoint = "sm" }: PageHeaderProps) {
    void hideTitleOnMobile
    void mobileBreakpoint

    return (
        <div className="flex min-w-0 max-w-full flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
                <h2 className="sr-only">{title}</h2>
                {subtitle && (
                    <p className="mt-1 max-w-prose text-sm text-muted-foreground">{subtitle}</p>
                )}
            </div>
            {actions && (
                <div className="flex min-w-0 max-w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
                    {actions}
                </div>
            )}
        </div>
    )
}
