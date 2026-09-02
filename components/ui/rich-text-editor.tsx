"use client";

import type { RefObject } from "react";
import { Bold, Heading2, Italic, List, Underline } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type RichTextEditorProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onFocus?: () => void;
  onSelect?: () => void;
  rows?: number;
  className?: string;
};

function wrapSelection(
  element: HTMLTextAreaElement | null,
  value: string,
  before: string,
  after: string,
  fallback: string,
) {
  const start = element?.selectionStart ?? value.length;
  const end = element?.selectionEnd ?? value.length;
  const selected = value.slice(start, end) || fallback;
  return {
    value: `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`,
    start: start + before.length,
    end: start + before.length + selected.length,
  };
}

export function RichTextEditor({ id, value, onChange, textareaRef, onFocus, onSelect, rows = 14, className = "" }: RichTextEditorProps) {
  function format(before: string, after: string, fallback = "tekst") {
    const result = wrapSelection(textareaRef.current, value, before, after, fallback);
    onChange(result.value);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(result.start, result.end);
    });
  }

  function addListItem() {
    const element = textareaRef.current;
    const start = element?.selectionStart ?? value.length;
    const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const result = `${value.slice(0, lineStart)}- ${value.slice(lineStart)}`;
    onChange(result);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(start + 2, start + 2);
    });
  }

  return (
    <div className="overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
      <div className="flex flex-wrap items-center gap-1 border-b bg-muted/30 p-2" role="toolbar" aria-label="Tekstformatering">
        <Button type="button" variant="ghost" size="icon" title="Fed" aria-label="Fed" onMouseDown={event => event.preventDefault()} onClick={() => format("**", "**")}><Bold className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="icon" title="Kursiv" aria-label="Kursiv" onMouseDown={event => event.preventDefault()} onClick={() => format("*", "*")}><Italic className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="icon" title="Understreget" aria-label="Understreget" onMouseDown={event => event.preventDefault()} onClick={() => format("[u]", "[/u]")}><Underline className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="icon" title="Overskrift" aria-label="Overskrift" onMouseDown={event => event.preventDefault()} onClick={() => format("[heading]", "[/heading]", "Overskrift")}><Heading2 className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="icon" title="Punkt" aria-label="Punkt" onMouseDown={event => event.preventDefault()} onClick={addListItem}><List className="h-4 w-4" /></Button>
        <label className="ml-1 flex items-center gap-2 text-xs text-muted-foreground">
          Tekststørrelse
          <select
            aria-label="Tekststørrelse"
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
            defaultValue="normal"
            onChange={event => {
              const size = event.target.value;
              if (size !== "normal") format(`[size=${size}]`, "[/size]");
              event.currentTarget.value = "normal";
            }}
          >
            <option value="normal">Normal</option>
            <option value="small">Lille</option>
            <option value="large">Stor</option>
          </select>
        </label>
      </div>
      <Textarea
        ref={textareaRef}
        id={id}
        rows={rows}
        className={`h-80 min-h-60 max-h-[60vh] resize-y overflow-y-auto rounded-none border-0 field-sizing-fixed focus-visible:ring-0 ${className}`}
        value={value}
        onFocus={onFocus}
        onSelect={onSelect}
        onChange={event => onChange(event.target.value)}
      />
    </div>
  );
}
