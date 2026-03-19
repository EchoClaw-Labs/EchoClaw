import chalk from "chalk";
import { isHeadless, writeStderr } from "./output.js";

const BAT_ASCII = [
  "                        ....",
  "         ..              ......",
  "      ....                .......",
  "     .....                 ........",
  "    ......                ..........",
  "   .......                 ..........",
  "  .........               ............",
  "  ...........             ............",
  " ...........           ...............",
  "  .........            ...............",
  "  ........ ...   ...     .............",
  "  ........ .... .....   .............",
  "   ..................................",
  "     ..............................",
  "       ..........................",
  "        .... ..  ............",
  "        ..........................",
  "         .......................",
  "           ..................",
  "               ..........",
] as const;

export const BAT_ASCII_LINES = BAT_ASCII;

export interface BatBannerOptions {
  animated?: boolean;
  delayMs?: number;
  subtitle?: string;
  description?: string;
}

function stylizeBatLine(line: string): string {
  return line
    .split("")
    .map((char) => (char === "." ? chalk.blueBright(".") : " "))
    .join("");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function centerText(text: string, width: number): string {
  const padding = Math.max(0, Math.floor((width - text.length) / 2));
  return " ".repeat(padding) + text;
}

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const TOTAL = BAT_ASCII.length;       // 20 lines
const EYE_LINE = 15;                  // face line with eye-gaps
const WING_LINES = 3;                 // lines 0-2 are wing tips

function overwriteLine(lineIdx: number, content: string): void {
  const up = TOTAL - lineIdx;
  process.stderr.write(`\x1B[${up}A\r\x1B[2K${content}\x1B[${up}B\r`);
}

// ── Pre-computed frames ──────────────────────────────────────────────────────

function buildFrames() {
  // Eye frames
  const eyeStr = BAT_ASCII[EYE_LINE];
  const indent = eyeStr.length - eyeStr.trimStart().length;
  const eyeOpen = stylizeBatLine(eyeStr);
  const eyeClosed = stylizeBatLine(" ".repeat(indent) + ".".repeat(eyeStr.length - indent));

  // Wing frames: "down" shifts top 3 lines down by 1 row
  const wingsUp = Array.from({ length: WING_LINES }, (_, i) => stylizeBatLine(BAT_ASCII[i]));
  const wingsDown = [
    "",                                        // line 0: tip gone (wing dipped)
    stylizeBatLine(BAT_ASCII[0]),              // line 1: old line 0
    stylizeBatLine(BAT_ASCII[1]),              // line 2: old line 1
  ];

  return { eyeOpen, eyeClosed, wingsUp, wingsDown };
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function renderBatBanner(options: BatBannerOptions = {}): Promise<boolean> {
  if (isHeadless()) {
    return false;
  }

  const animated = options.animated ?? true;
  const delayMs = Math.max(0, options.delayMs ?? 25);

  // Draw bat line-by-line
  for (let i = 0; i < TOTAL; i++) {
    writeStderr(stylizeBatLine(BAT_ASCII[i]));
    if (animated && delayMs > 0 && i < TOTAL - 1) {
      await sleep(delayMs);
    }
  }

  // Animated loop: wing flaps + eye blinks
  if (animated) {
    const { eyeOpen, eyeClosed, wingsUp, wingsDown } = buildFrames();

    const setWings = (frame: string[]) => {
      for (let i = 0; i < WING_LINES; i++) overwriteLine(i, frame[i]);
    };

    const blink = async () => {
      overwriteLine(EYE_LINE, eyeClosed);
      await sleep(100);
      overwriteLine(EYE_LINE, eyeOpen);
    };

    // 4 flap cycles (~2.8 s total), blink on cycles 1 and 3
    for (let c = 0; c < 4; c++) {
      await sleep(280);
      setWings(wingsDown);

      if (c === 1 || c === 3) await blink();

      await sleep(280);
      setWings(wingsUp);
    }

    await sleep(150);
  }

  // Branding
  writeStderr("");
  writeStderr(
    "  " + chalk.whiteBright("EchoClaw") + chalk.blue(" · ") + chalk.blueBright("0G Network")
  );
  writeStderr(chalk.gray("  " + "─".repeat(34)));
  if (options.subtitle) {
    writeStderr("  " + chalk.bold(options.subtitle));
  }
  if (options.description) {
    writeStderr("  " + chalk.gray(options.description));
  }
  writeStderr("");

  return true;
}
