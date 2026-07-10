interface PageHeaderProps {
    title: string
    subtitle?: string
    actions?: React.ReactNode
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
    return (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
                <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
                {subtitle && (
                    <p className="mt-1 max-w-prose text-sm text-muted-foreground">{subtitle}</p>
                )}
            </div>
            {actions && (
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
                    {actions}
                </div>
            )}
        </div>
    )
}
