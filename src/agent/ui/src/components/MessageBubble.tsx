import { type FC } from "react";
import Markdown from "markdown-to-jsx";
import { cn } from "../utils";
import { AgentAvatar } from "./AgentAvatar";

interface MessageBubbleProps {
  content: string;
  variant: "sent" | "received";
  grouped?: "first" | "middle" | "last" | "single";
  timestamp?: string;
  seed?: string;
}

/** Markdown overrides using CSS-variable colours so they work in both themes. */
const markdownOverrides = {
  overrides: {
    h1: { component: "h3" as const, props: { className: "text-base font-semibold text-foreground mt-4 mb-2" } },
    h2: { component: "h4" as const, props: { className: "text-sm font-semibold text-foreground mt-4 mb-2" } },
    h3: { component: "h5" as const, props: { className: "text-sm font-medium text-foreground/90 mt-3 mb-2" } },
    p: { component: "p" as const, props: { className: "mb-3 leading-relaxed last:mb-0" } },
    a: { component: "a" as const, props: { className: "text-accent hover:underline", target: "_blank", rel: "noopener noreferrer" } },
    ul: { component: "ul" as const, props: { className: "list-disc list-inside mb-3 space-y-1" } },
    ol: { component: "ol" as const, props: { className: "list-decimal list-inside mb-3 space-y-1" } },
    li: { component: "li" as const, props: { className: "text-sm" } },
    code: { component: "code" as const, props: { className: "bg-muted/50 px-1.5 py-0.5 rounded-md text-xs font-mono text-accent/90" } },
    pre: { component: "pre" as const, props: { className: "bg-muted/30 border border-border/50 rounded-xl p-4 my-3 overflow-x-auto text-xs font-mono text-foreground/90 leading-relaxed" } },
    blockquote: { component: "blockquote" as const, props: { className: "border-l-2 border-accent/40 pl-4 my-3 text-muted-foreground italic" } },
    table: { component: "table" as const, props: { className: "text-sm w-full my-3 border-collapse" } },
    th: { component: "th" as const, props: { className: "text-left px-3 py-2 border-b border-border/80 text-muted-foreground font-medium" } },
    td: { component: "td" as const, props: { className: "px-3 py-2 border-b border-border/30" } },
    strong: { component: "strong" as const, props: { className: "font-semibold text-foreground" } },
    em: { component: "em" as const, props: { className: "italic text-foreground/80" } },
    hr: { component: "hr" as const, props: { className: "border-border/50 my-4" } },
  },
};

export const MessageBubble: FC<MessageBubbleProps> = ({
  content,
  variant,
  timestamp,
  seed,
}) => {
  const isSent = variant === "sent";

  if (isSent) {
    return (
      <div className="flex justify-end mb-6 group w-full">
        <div className="max-w-[80%] flex flex-col items-end">
          <div className="bg-muted/60 text-foreground px-5 py-3 rounded-3xl rounded-tr-sm text-sm leading-relaxed break-words border border-border/40 shadow-sm">
            <span className="whitespace-pre-wrap">{content}</span>
          </div>
          {timestamp && (
            <div className="text-[10px] mt-1.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity pr-1">
              {timestamp}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Received (Agent) - Flat layout like Grok/Claude
  return (
    <div className="flex justify-start mb-8 group w-full">
      <div className="w-full flex gap-4 max-w-full">
        {/* Agent avatar */}
        <div className="flex-shrink-0 mt-0.5">
          <AgentAvatar seed={seed ?? "echo"} size={28} animated={false} />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="text-sm text-foreground/90 leading-relaxed break-words w-full max-w-none">
            <Markdown options={markdownOverrides}>{content}</Markdown>
          </div>
          {timestamp && (
            <div className="text-[10px] mt-2 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity">
              {timestamp}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
