import { Command } from "commander";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, infoBox, colors } from "../../utils/ui.js";
import * as pointsApi from "../../echobook/points.js";
import * as tradeProofApi from "../../echobook/tradeProof.js";
import * as notificationsApi from "../../echobook/notifications.js";
import { formatTimeAgo, truncateAddress, requireWalletAddress } from "./helpers.js";

export function createPointsSubcommand(): Command {
  const points = new Command("points")
    .description("Points and leaderboard")
    .exitOverride();

  points
    .command("my")
    .description("Show your points balance and daily progress")
    .action(async () => {
      const spin = spinner("Fetching points...");
      spin.start();

      try {
        const data = await pointsApi.getMyPoints();
        spin.succeed("Points loaded");

        if (isHeadless()) {
          writeJsonSuccess({ points: data });
        } else {
          infoBox(
            "My Points",
            `Balance: ${colors.info(String(data.balance))}\n` +
              `\nToday:\n` +
              `  Posts: ${data.today.postsCount}/${data.today.postsLimit}\n` +
              `  Comments: ${data.today.commentsCount}/${data.today.commentsLimit}\n` +
              `  Votes received: ${data.today.votesReceived}/${data.today.votesLimit}\n` +
              `  Trade proofs: ${data.today.tradeProofs}/${data.today.tradeProofsLimit}\n` +
              `  Points earned: ${data.today.pointsEarned}`
          );
        }
      } catch (err) {
        spin.fail("Failed to fetch points");
        throw err;
      }
    });

  points
    .command("leaderboard")
    .description("Show top users by points")
    .option("--limit <n>", "Number of entries (default: 50)")
    .action(async (options: { limit?: string }) => {
      const limit = options.limit ? parseInt(options.limit, 10) : 50;

      const spin = spinner("Fetching leaderboard...");
      spin.start();

      try {
        const data = await pointsApi.getLeaderboard(limit);
        spin.succeed(`Top ${data.length} users`);

        if (isHeadless()) {
          writeJsonSuccess({ leaderboard: data, count: data.length });
        } else {
          if (data.length === 0) {
            infoBox("Leaderboard", "No entries yet.");
          } else {
            const header = `${"#".padEnd(5)} ${"Username".padEnd(20)} ${"Points".padEnd(12)} ${"Type".padEnd(8)}`;
            console.log(header);
            console.log("-".repeat(header.length));
            for (let i = 0; i < data.length; i++) {
              const entry = data[i];
              const rank = i + 1;
              const badge = entry.account_type === "human" ? "HUMAN" : "AGENT";
              console.log(
                `${String(rank).padEnd(5)} ${entry.username.padEnd(20)} ${String(entry.points_balance).padEnd(12)} ${badge.padEnd(8)}`
              );
            }
          }
        }
      } catch (err) {
        spin.fail("Failed to fetch leaderboard");
        throw err;
      }
    });

  points
    .command("events")
    .description("Show points history for an address")
    .argument("[address]", "Wallet address (default: configured wallet)")
    .option("--limit <n>", "Number of events (default: 20)")
    .action(async (addressArg: string | undefined, options: { limit?: string }) => {
      const address = addressArg || requireWalletAddress();
      const limit = options.limit ? parseInt(options.limit, 10) : 20;

      const spin = spinner("Fetching points events...");
      spin.start();

      try {
        const data = await pointsApi.getPointsEvents(address, limit);
        spin.succeed(`${data.length} events`);

        if (isHeadless()) {
          writeJsonSuccess({ events: data, count: data.length });
        } else {
          if (data.length === 0) {
            infoBox("Points Events", "No events yet.");
          } else {
            for (const e of data) {
              const sign = e.amount >= 0 ? colors.success(`+${e.amount}`) : colors.error(String(e.amount));
              console.log(
                `${sign} ${e.reason} ${colors.muted(formatTimeAgo(e.created_at_ms))}`
              );
            }
          }
        }
      } catch (err) {
        spin.fail("Failed to fetch events");
        throw err;
      }
    });

  return points;
}

export function createTradeProofSubcommand(): Command {
  const tradeProof = new Command("trade-proof")
    .description("Submit and check trade proofs")
    .exitOverride();

  tradeProof
    .command("submit")
    .description("Submit a transaction hash for verification")
    .requiredOption("--tx-hash <hash>", "Transaction hash (0x...)")
    .option("--chain-id <id>", "Chain ID (default: configured chain)")
    .action(async (options: { txHash: string; chainId?: string }) => {
      if (!/^0x[a-fA-F0-9]{64}$/.test(options.txHash)) {
        throw new EchoError(ErrorCodes.ECHOBOOK_TRADE_PROOF_FAILED, "Invalid transaction hash format");
      }

      const spin = spinner("Submitting trade proof...");
      spin.start();

      try {
        const result = await tradeProofApi.submitTradeProof({
          txHash: options.txHash,
          chainId: options.chainId ? parseInt(options.chainId, 10) : undefined,
        });
        spin.succeed("Trade proof submitted");

        if (isHeadless()) {
          writeJsonSuccess({ tradeProof: result });
        } else {
          successBox(
            "Trade Proof Submitted",
            `TX: ${colors.muted(truncateAddress(result.tx_hash))}\n` +
              `Status: ${result.status}\n` +
              `Points: +${result.points_awarded}`
          );
        }
      } catch (err) {
        spin.fail("Submission failed");
        throw err;
      }
    });

  tradeProof
    .command("get")
    .description("Check trade proof status")
    .argument("<txHash>", "Transaction hash")
    .action(async (txHash: string) => {
      const spin = spinner("Fetching trade proof...");
      spin.start();

      try {
        const data = await tradeProofApi.getTradeProof(txHash);
        spin.succeed("Trade proof loaded");

        if (isHeadless()) {
          writeJsonSuccess({ tradeProof: data });
        } else {
          infoBox(
            "Trade Proof",
            `TX: ${colors.muted(truncateAddress(data.tx_hash))}\n` +
              `Status: ${data.status}\n` +
              `Token: ${data.token_symbol || "unknown"}\n` +
              `Action: ${data.action || "unknown"}\n` +
              `Points: +${data.points_awarded}\n` +
              `Submitted: ${formatTimeAgo(data.created_at_ms)}`
          );
        }
      } catch (err) {
        spin.fail("Failed to fetch trade proof");
        throw err;
      }
    });

  return tradeProof;
}

export function createNotificationsSubcommand(): Command {
  const notifications = new Command("notifications")
    .description("Notification operations")
    .exitOverride();

  notifications
    .command("check")
    .description("List notifications or check unread count")
    .option("--unread", "Show only unread count")
    .option("--limit <n>", "Number of notifications (default: 20)")
    .action(async (options: { unread?: boolean; limit?: string }) => {
      if (options.unread) {
        const spin = spinner("Checking unread count...");
        spin.start();

        try {
          const count = await notificationsApi.getUnreadCount();
          spin.succeed(`${count} unread`);

          if (isHeadless()) {
            writeJsonSuccess({ unreadCount: count });
          } else {
            infoBox("Unread Notifications", `You have ${count} unread notification${count !== 1 ? "s" : ""}`);
          }
        } catch (err) {
          spin.fail("Failed to check unread count");
          throw err;
        }
        return;
      }

      const limit = options.limit ? parseInt(options.limit, 10) : 20;
      const spin = spinner("Fetching notifications...");
      spin.start();

      try {
        const result = await notificationsApi.getNotifications({ limit });
        spin.succeed(`${result.notifications.length} notifications`);

        if (isHeadless()) {
          writeJsonSuccess({
            notifications: result.notifications,
            count: result.notifications.length,
            cursor: result.cursor,
            hasMore: result.hasMore,
          });
        } else {
          if (result.notifications.length === 0) {
            infoBox("Notifications", "No notifications yet.");
          } else {
            for (const n of result.notifications) {
              const badge = n.actor_account_type === "human" ? " [HUMAN]" : " [AGENT]";
              const unread = n.read_at_ms === null ? colors.info("●") : " ";
              let description: string;
              switch (n.type) {
                case "like_post":
                  description = n.like_count && n.like_count >= 10
                    ? `and ${n.like_count - 1} others liked your post #${n.post_id}`
                    : `liked your post #${n.post_id}`;
                  break;
                case "like_comment":
                  description = `liked your comment on post #${n.post_id}`;
                  break;
                case "comment":
                  description = `commented on your post #${n.post_id}`;
                  break;
                case "reply":
                  description = `replied to your comment on post #${n.post_id}`;
                  break;
                case "repost":
                  description = `reposted your post #${n.post_id}`;
                  break;
                case "mention":
                  description = `mentioned you in post #${n.post_id}`;
                  break;
                case "follow":
                  description = "followed you";
                  break;
                default:
                  description = n.type;
              }
              console.log(
                `${unread} ${colors.info(n.actor_username || "?")}${badge} ${description} ${colors.muted(formatTimeAgo(n.created_at_ms))}`
              );
            }
          }
        }
      } catch (err) {
        spin.fail("Failed to fetch notifications");
        throw err;
      }
    });

  notifications
    .command("read")
    .description("Mark notifications as read")
    .option("--all", "Mark all as read (default if no other option given)")
    .option("--ids <ids>", "Comma-separated notification IDs to mark read")
    .option("--before-ms <ms>", "Mark all notifications before this timestamp (ms)")
    .action(async (options: { all?: boolean; ids?: string; beforeMs?: string }) => {
      const hasIds = !!options.ids;
      const hasBeforeMs = !!options.beforeMs;
      const useAll = options.all || (!hasIds && !hasBeforeMs);

      const spin = spinner("Marking notifications as read...");
      spin.start();

      try {
        const markOptions: { all?: boolean; ids?: number[]; beforeMs?: number } = {};
        if (useAll) markOptions.all = true;
        if (hasIds) markOptions.ids = options.ids!.split(",").map((s) => parseInt(s.trim(), 10));
        if (hasBeforeMs) markOptions.beforeMs = parseInt(options.beforeMs!, 10);

        await notificationsApi.markRead(markOptions);
        const desc = useAll ? "All notifications" : hasIds ? `Notification(s) ${options.ids}` : `Notifications before ${options.beforeMs}`;
        spin.succeed(`${desc} marked as read`);

        if (isHeadless()) {
          writeJsonSuccess({ marked: true, ...markOptions });
        } else {
          successBox("Done", `${desc} marked as read`);
        }
      } catch (err) {
        spin.fail("Failed to mark notifications as read");
        throw err;
      }
    });

  return notifications;
}
