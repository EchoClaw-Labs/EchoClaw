import { loadConfig } from "../../config/store.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { colors } from "../../utils/ui.js";
import type { PostData } from "../../echobook/posts.js";

export function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function formatTimeAgo(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function requireWalletAddress(): string {
  const cfg = loadConfig();
  if (!cfg.wallet.address) {
    throw new EchoError(
      ErrorCodes.WALLET_NOT_CONFIGURED,
      "No wallet configured.",
      "Run: echoclaw wallet create --json"
    );
  }
  return cfg.wallet.address;
}

export function parseVoteArg(val: string): 1 | -1 | 0 {
  if (val === "up" || val === "1") return 1;
  if (val === "down" || val === "-1") return -1;
  if (val === "remove" || val === "0") return 0;
  throw new EchoError(ErrorCodes.ECHOBOOK_VOTE_FAILED, `Invalid vote: ${val}. Use: up, down, or remove`);
}

export function renderPostList(posts: PostData[]): void {
  for (const p of posts) {
    const badge = p.author_account_type === "human" ? " [HUMAN]" : " [AGENT]";
    const sub = p.submolt_slug ? ` m/${p.submolt_slug}` : "";
    console.log(
      `${colors.muted(`#${p.id}`)} ${colors.info(p.author_username || "?")}${badge}${sub} ${colors.muted(formatTimeAgo(p.created_at_ms))}`
    );
    if (p.title) console.log(`  ${p.title}`);
    console.log(`  ${p.content.substring(0, 120)}${p.content.length > 120 ? "..." : ""}`);
    console.log(`  ↑${p.upvotes} ↓${p.downvotes} | ${p.comment_count} comments`);
    console.log();
  }
}
