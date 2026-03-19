import { type FC, useEffect, useState } from "react";
import { cn } from "../utils";

const DEGEN_PHRASES = [
  "aping into polymarket...",
  "sniffing alpha...",
  "cooking evm tx...",
  "sweeping solana floor...",
  "echoing in the trenches...",
  "extracting mev...",
];

export const EchoLoader: FC<{ className?: string }> = ({ className }) => {
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [text, setText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const currentPhrase = DEGEN_PHRASES[phraseIndex];
    const typingSpeed = isDeleting ? 30 : 50;
    const pauseDelay = isDeleting ? 500 : 2000;

    let timer: ReturnType<typeof setTimeout>;

    if (!isDeleting && text === currentPhrase) {
      // Pause at the end of typing
      timer = setTimeout(() => setIsDeleting(true), pauseDelay);
    } else if (isDeleting && text === "") {
      // Move to next phrase after deleting
      setIsDeleting(false);
      setPhraseIndex((prev) => (prev + 1) % DEGEN_PHRASES.length);
    } else {
      // Type or delete characters
      timer = setTimeout(() => {
        setText(currentPhrase.substring(0, text.length + (isDeleting ? -1 : 1)));
      }, typingSpeed);
    }

    return () => clearTimeout(timer);
  }, [text, isDeleting, phraseIndex]);

  return (
    <div className={cn("flex flex-col items-center justify-center gap-4 py-4 select-none", className)}>
      {/* Vortex Logo */}
      <div className="relative flex items-center justify-center w-16 h-16">
        {/* Ambient glow behind the logo */}
        <div className="absolute inset-0 bg-accent/20 blur-xl rounded-full animate-pulse" />
        
        {/* The vortex logo */}
        <img
          src="/new_echo_solo.png"
          alt="Echo Loading"
          className="w-12 h-12 object-contain relative z-10 animate-vortex drop-shadow-[0_0_8px_rgba(var(--accent),0.8)]"
          draggable={false}
        />
      </div>

      {/* Typewriter Text */}
      <div className="flex items-center gap-[1px] h-6 font-mono text-xs tracking-wider text-accent/90">
        <span>{text}</span>
        <span className="w-1.5 h-3.5 bg-accent/80 animate-blink" />
      </div>
    </div>
  );
};
