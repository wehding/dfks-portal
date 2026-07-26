import { PageHeader, type PageHeaderProps } from "@/components/page-header"

type PortalPageHeaderProps = Omit<PageHeaderProps, "hideTitleOnMobile" | "mobileBreakpoint">

export function PortalPageHeader(props: PortalPageHeaderProps) {
    return <PageHeader {...props} hideTitleOnMobile mobileBreakpoint="md" />
}
