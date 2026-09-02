const TOKEN_PATTERN = /\[(?:\/)?(?:u|size=(?:small|normal|large)|heading)\]|\*\*|\*/gi;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Converts the deliberately small formatting language used by organisation
 * templates to safe HTML. User supplied HTML is escaped before formatting is
 * applied, so this output is safe to use in email and controlled previews.
 */
export function safeRichTextToHtml(value: string): string {
  let html = escapeHtml(value);
  html = html.replace(/\[heading\]([\s\S]*?)\[\/heading\]/gi, '<strong style="display:block;font-size:1.25em;line-height:1.35;margin:.75em 0 .25em">$1</strong>');
  html = html.replace(/\[size=small\]([\s\S]*?)\[\/size\]/gi, '<span style="font-size:.875em">$1</span>');
  html = html.replace(/\[size=normal\]([\s\S]*?)\[\/size\]/gi, '<span style="font-size:1em">$1</span>');
  html = html.replace(/\[size=large\]([\s\S]*?)\[\/size\]/gi, '<span style="font-size:1.125em">$1</span>');
  html = html.replace(/\[u\]([\s\S]*?)\[\/u\]/gi, "<u>$1</u>");
  html = html.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>");
  html = html.replace(/^[-•]\s+(.+)$/gm, '<span style="display:block;padding-left:1em">• $1</span>');
  return html.replace(/\r?\n/g, "<br>");
}

export function richTextToPlainText(value: string): string {
  return value.replace(TOKEN_PATTERN, "").replace(/^[-•]\s+/gm, "• ");
}

