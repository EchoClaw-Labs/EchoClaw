import { type FC, useState, useRef, useEffect, useCallback } from "react";
import { HugeiconsIcon, ArrowUp01Icon } from "./icons";
import { cn } from "../utils";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export const ChatInput: FC<ChatInputProps> = ({
  onSend,
  disabled = false,
  placeholder = "Ask anything...",
  className,
}) => {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [input]);

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || disabled) return;

    onSend(text);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [input, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const hasContent = input.trim() !== "";

  return (
    <div className={cn(
      "flex flex-col w-full rounded-[32px] bg-card border border-border px-2 py-2 shadow-sm transition-colors focus-within:bg-muted focus-within:border-muted-foreground/20",
      className,
    )}>
      <div className="flex items-end min-h-[40px]">
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
          placeholder={placeholder}
          className="flex-1 resize-none bg-transparent py-2.5 px-4 text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          style={{ maxHeight: 200 }}
        />

        {/* Right side: Send */}
        <div className="flex items-center gap-1 shrink-0 h-10 px-1">
          <button
            onClick={handleSubmit}
            disabled={!hasContent || disabled}
            className={cn(
              "flex h-8 w-8 ml-1 items-center justify-center rounded-full transition-all",
              hasContent && !disabled
                ? "bg-white text-black hover:scale-105"
                : "bg-white/10 text-white/40",
            )}
          >
            <HugeiconsIcon icon={ArrowUp01Icon} size={18} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
};
