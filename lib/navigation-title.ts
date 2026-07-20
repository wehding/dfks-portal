export type NavigationTitleItem = {
  href: string;
  label: string;
};

export function resolveNavigationTitle(
  pathname: string | null | undefined,
  items: NavigationTitleItem[],
  fallback: string,
) {
  if (!pathname) return fallback;
  const match = [...items]
    .sort((a, b) => b.href.length - a.href.length)
    .find(item => pathname === item.href || pathname.startsWith(`${item.href}/`));
  return match?.label ?? fallback;
}
