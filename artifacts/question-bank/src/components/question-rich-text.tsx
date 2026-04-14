import { Fragment, type ReactNode } from "react";
import { InlineMath, BlockMath } from "react-katex";
import { ImageIcon } from "lucide-react";

type Segment =
  | { type: "text"; content: string }
  | { type: "inlineMath"; content: string }
  | { type: "blockMath"; content: string }
  | { type: "image"; alt: string; src: string };

const latexCommandPattern = /\\(?:frac|sqrt|sum|int|lim|Delta|delta|theta|alpha|beta|gamma|pi|times|div|cdot|leq|geq|neq|approx|angle|sin|cos|tan|log|ln|overline|underline|vec|rightarrow|leftarrow|Rightarrow|Leftarrow)\b/;

function cleanupExtractedText(text: string): string {
  return text
    .replace(/\s*Question ID\s*:\s*\d+[\s\S]*?(?=(?:\n\s*\n)|$)/gi, "")
    .replace(/\s*Option\s+\d+\s+ID\s*:\s*\d+/gi, "")
    .replace(/\s*Status\s*:\s*(?:Answered|Not Answered|Not Visited|Marked).*$/gim, "")
    .replace(/\s*Chosen Option\s*:\s*[-\d]+/gi, "")
    .replace(/!\[([^\]]*)\]\((?!https?:\/\/|\/api\/)(?:[^)]+\.jpg|[^)]+\.jpeg|[^)]+\.png|[^)]+\.webp)\)/gi, "[$1]")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pushTextWithInlineLatex(segments: Segment[], value: string) {
  const inlinePattern = /(\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = inlinePattern.exec(value)) !== null) {
    if (match.index > cursor) {
      pushTextWithBareLatex(segments, value.slice(cursor, match.index));
    }
    segments.push({ type: "inlineMath", content: (match[2] ?? match[3] ?? "").trim() });
    cursor = match.index + match[0].length;
  }

  if (cursor < value.length) {
    pushTextWithBareLatex(segments, value.slice(cursor));
  }
}

function pushTextWithBareLatex(segments: Segment[], value: string) {
  if (!latexCommandPattern.test(value)) {
    segments.push({ type: "text", content: value });
    return;
  }

  const parts = value.split(/(\s+)/);
  for (const part of parts) {
    if (!part) continue;
    if (latexCommandPattern.test(part)) {
      segments.push({ type: "inlineMath", content: part });
    } else {
      segments.push({ type: "text", content: part });
    }
  }
}

function toSegments(input: string): Segment[] {
  const text = cleanupExtractedText(input);
  const segments: Segment[] = [];
  const blockPattern = /(\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|!\[([^\]]*)\]\(([^)]+)\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = blockPattern.exec(text)) !== null) {
    if (match.index > cursor) {
      pushTextWithInlineLatex(segments, text.slice(cursor, match.index));
    }

    if (match[5]) {
      segments.push({ type: "image", alt: match[4] || "Extracted figure", src: match[5] });
    } else {
      segments.push({ type: "blockMath", content: (match[2] ?? match[3] ?? "").trim() });
    }

    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    pushTextWithInlineLatex(segments, text.slice(cursor));
  }

  return segments;
}

function renderPlainMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`)/g;
  let cursor = 0;
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    if (match[2] || match[3]) {
      nodes.push(<strong key={`${keyPrefix}-strong-${index}`}>{match[2] ?? match[3]}</strong>);
    } else {
      nodes.push(<code key={`${keyPrefix}-code-${index}`} className="rounded bg-muted px-1 py-0.5 text-[0.92em]">{match[4]}</code>);
    }
    cursor = match.index + match[0].length;
    index++;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export function QuestionRichText({ text, className = "" }: { text?: string | null; className?: string }) {
  if (!text) return null;
  const segments = toSegments(text);

  return (
    <span className={`question-rich-text whitespace-pre-wrap break-words leading-relaxed ${className}`}>
      {segments.map((segment, index) => {
        if (segment.type === "inlineMath") {
          return (
            <InlineMath
              key={index}
              math={segment.content}
              renderError={() => <span className="font-mono text-[0.95em]">{segment.content}</span>}
            />
          );
        }
        if (segment.type === "blockMath") {
          return (
            <span key={index} className="my-2 block overflow-x-auto rounded-md bg-muted/40 px-2 py-1">
              <BlockMath
                math={segment.content}
                renderError={() => <span className="font-mono text-[0.95em]">{segment.content}</span>}
              />
            </span>
          );
        }
        if (segment.type === "image") {
          const isRealUrl = segment.src.startsWith("/") || segment.src.startsWith("http");
          if (isRealUrl) {
            return (
              <span key={index} className="my-2 block">
                <img
                  src={segment.src}
                  alt={segment.alt || "Figure"}
                  className="max-w-full rounded-md border"
                  loading="lazy"
                />
                {segment.alt && (
                  <span className="mt-1 block text-xs text-muted-foreground">{segment.alt}</span>
                )}
              </span>
            );
          }
          return (
            <span key={index} className="my-2 flex items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <ImageIcon className="h-3.5 w-3.5 shrink-0" />
              Figure reference: {segment.alt || segment.src.split("/").pop() || "image"}
            </span>
          );
        }

        return <Fragment key={index}>{renderPlainMarkdown(segment.content, `md-${index}`)}</Fragment>;
      })}
    </span>
  );
}