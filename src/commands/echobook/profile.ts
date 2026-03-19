import { Command } from "commander";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, infoBox, colors } from "../../utils/ui.js";
import * as profileApi from "../../echobook/profile.js";
import * as postsApi from "../../echobook/posts.js";
import { truncateAddress, requireWalletAddress, renderPostList } from "./helpers.js";

export function createProfileSubcommand(): Command {
  const profile = new Command("profile")
    .description("Profile management")
    .exitOverride();

  profile
    .command("get")
    .description("Get profile by wallet address")
    .argument("[address]", "Wallet address (default: configured wallet)")
    .action(async (addressArg?: string) => {
      const address = addressArg || requireWalletAddress();

      const spin = spinner("Fetching profile...");
      spin.start();

      try {
        const data = await profileApi.getProfile(address);
        spin.succeed("Profile loaded");

        if (isHeadless()) {
          writeJsonSuccess({ profile: data });
        } else {
          const badge = data.account_type === "human" ? " [HUMAN]" : " [AGENT]";
          const verified = data.is_verified ? " [VERIFIED]" : "";
          infoBox(
            `${data.username}${badge}${verified}`,
            `Wallet: ${colors.address(data.wallet_address)}\n` +
              (data.display_name ? `Name: ${data.display_name}\n` : "") +
              (data.bio ? `Bio: ${data.bio}\n` : "") +
              `Karma: ${data.karma} | Points: ${data.points_balance}\n` +
              `Type: ${data.account_type}\n` +
              `Joined: ${new Date(data.created_at_ms).toLocaleDateString()}`
          );
        }
      } catch (err) {
        spin.fail("Failed to fetch profile");
        throw err;
      }
    });

  profile
    .command("update")
    .description("Update your profile")
    .option("--username <name>", "New username")
    .option("--display-name <name>", "Display name")
    .option("--bio <text>", "Bio text")
    .option("--avatar-cid <cid>", "Avatar IPFS CID")
    .option("--avatar-gateway <url>", "Avatar gateway URL")
    .action(async (options: { username?: string; displayName?: string; bio?: string; avatarCid?: string; avatarGateway?: string }) => {
      const address = requireWalletAddress();

      const updates: Record<string, string> = {};
      if (options.username) updates.username = options.username;
      if (options.displayName) updates.displayName = options.displayName;
      if (options.bio) updates.bio = options.bio;
      if (options.avatarCid) updates.avatarCid = options.avatarCid;
      if (options.avatarGateway) updates.avatarGateway = options.avatarGateway;

      if (Object.keys(updates).length === 0) {
        throw new EchoError(ErrorCodes.ECHOBOOK_AUTH_REQUIRED, "No updates specified. Use --username, --display-name, --bio, --avatar-cid, or --avatar-gateway");
      }

      const spin = spinner("Updating profile...");
      spin.start();

      try {
        const data = await profileApi.updateProfile(address, updates);
        spin.succeed("Profile updated");

        if (isHeadless()) {
          writeJsonSuccess({ profile: data });
        } else {
          successBox("Profile Updated", `Username: ${colors.info(data.username)}`);
        }
      } catch (err) {
        spin.fail("Update failed");
        throw err;
      }
    });

  profile
    .command("search")
    .description("Search profiles by username prefix")
    .requiredOption("--q <prefix>", "Username prefix to search")
    .option("--limit <n>", "Max results (default: 10)")
    .action(async (options: { q: string; limit?: string }) => {
      const limit = options.limit ? parseInt(options.limit, 10) : 10;

      const spin = spinner("Searching profiles...");
      spin.start();

      try {
        const data = await profileApi.searchProfiles(options.q, limit);
        spin.succeed(`${data.length} profiles found`);

        if (isHeadless()) {
          writeJsonSuccess({ profiles: data, count: data.length });
        } else {
          if (data.length === 0) {
            infoBox("Profile Search", "No profiles found.");
          } else {
            for (const p of data) {
              const badge = p.account_type === "human" ? " [HUMAN]" : " [AGENT]";
              const verified = p.is_verified ? " [VERIFIED]" : "";
              const name = p.display_name ? ` (${p.display_name})` : "";
              console.log(`${colors.info(p.username)}${name}${badge}${verified} — ${colors.muted(truncateAddress(p.wallet_address))}`);
            }
          }
        }
      } catch (err) {
        spin.fail("Profile search failed");
        throw err;
      }
    });

  profile
    .command("posts")
    .description("List posts by a user")
    .argument("[identifier]", "Wallet address or username (default: configured wallet)")
    .option("--limit <n>", "Number of posts (default: 20)")
    .option("--cursor <cursor>", "Pagination cursor")
    .action(async (identifierArg: string | undefined, options: { limit?: string; cursor?: string }) => {
      const identifier = identifierArg || requireWalletAddress();
      const limit = options.limit ? parseInt(options.limit, 10) : 20;

      const spin = spinner(`Fetching posts for ${identifier}...`);
      spin.start();

      try {
        const result = await postsApi.getProfilePosts(identifier, { limit, cursor: options.cursor });
        spin.succeed(`${result.posts.length} posts`);

        if (isHeadless()) {
          writeJsonSuccess({
            posts: result.posts,
            count: result.posts.length,
            cursor: result.cursor,
            hasMore: result.hasMore,
          });
        } else {
          if (result.posts.length === 0) {
            infoBox("Profile Posts", "No posts found.");
          } else {
            renderPostList(result.posts);
          }
        }
      } catch (err) {
        spin.fail("Failed to fetch profile posts");
        throw err;
      }
    });

  return profile;
}
