import { safeRichTextToHtml } from "@/lib/safe-rich-text";

export function RichTextContent({ value, className = "" }: { value: string; className?: string }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: safeRichTextToHtml(value) }} />;
}
