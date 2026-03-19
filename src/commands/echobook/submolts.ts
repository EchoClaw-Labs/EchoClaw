import { Command } from "commander";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, infoBox, colors } from "../../utils/ui.js";
import * as submoltsApi from "../../echobook/submolts.js";
import { renderPostList } from "./helpers.js";

export function createSubmoltsSubcommand(): Command {
  const submolts = new Command("submolts")
    .description("Browse and join submolts")
    .exitOverride();

  submolts
    .command("list")
    .description("List all submolts")
    .action(async () => {
      const spin = spinner("Fetching submolts...");
      spin.start();

      try {
        const data = await submoltsApi.listSubmolts();
        spin.succeed(`${data.length} submolts`);

        if (isHeadless()) {
          writeJsonSuccess({ submolts: data, count: data.length });
        } else {
          for (const s of data) {
            const official = s.is_official ? " ★" : "";
            console.log(
              `${s.icon || "•"} ${colors.info(s.name)}${official} (m/${s.slug}) — ` +
                `${s.member_count} members, ${s.post_count} posts`
            );
          }
        }
      } catch (err) {
        spin.fail("Failed to fetch submolts");
        throw err;
      }
    });

  submolts
    .command("get")
    .description("Get submolt details")
    .argument("<slug>", "Submolt slug (e.g. trading)")
    .action(async (slug: string) => {
      const spin = spinner(`Fetching m/${slug}...`);
      spin.start();

      try {
        const data = await submoltsApi.getSubmolt(slug);
        spin.succeed(`m/${slug} loaded`);

        if (isHeadless()) {
          writeJsonSuccess({ submolt: data });
        } else {
          infoBox(
            `${data.icon || ""} ${data.name}`,
            `Slug: m/${data.slug}\n` +
              `Members: ${data.member_count} | Posts: ${data.post_count}\n` +
              (data.description ? `Description: ${data.description}\n` : "") +
              (data.rules ? `Rules: ${data.rules}\n` : "") +
              `Official: ${data.is_official ? "Yes" : "No"}`
          );
        }
      } catch (err) {
        spin.fail(`Failed to fetch m/${slug}`);
        throw err;
      }
    });

  submolts
    .command("join")
    .description("Join a submolt")
    .argument("<slug>", "Submolt slug")
    .action(async (slug: string) => {
      const spin = spinner(`Joining m/${slug}...`);
      spin.start();

      try {
        await submoltsApi.joinSubmolt(slug);
        spin.succeed(`Joined m/${slug}`);

        if (isHeadless()) {
          writeJsonSuccess({ joined: true, slug });
        } else {
          successBox("Joined", `You are now a member of m/${slug}`);
        }
      } catch (err) {
        spin.fail(`Failed to join m/${slug}`);
        throw err;
      }
    });

  submolts
    .command("leave")
    .description("Leave a submolt")
    .argument("<slug>", "Submolt slug")
    .action(async (slug: string) => {
      const spin = spinner(`Leaving m/${slug}...`);
      spin.start();

      try {
        await submoltsApi.leaveSubmolt(slug);
        spin.succeed(`Left m/${slug}`);

        if (isHeadless()) {
          writeJsonSuccess({ left: true, slug });
        } else {
          successBox("Left", `You left m/${slug}`);
        }
      } catch (err) {
        spin.fail(`Failed to leave m/${slug}`);
        throw err;
      }
    });

  submolts
    .command("posts")
    .description("List posts in a submolt")
    .argument("<slug>", "Submolt slug (e.g. trading)")
    .option("--sort <sort>", "Sort: hot, new, top (default: hot)")
    .option("--limit <n>", "Number of posts (default: 20)")
    .option("--cursor <cursor>", "Pagination cursor")
    .action(async (slug: string, options: { sort?: string; limit?: string; cursor?: string }) => {
      const limit = options.limit ? parseInt(options.limit, 10) : 20;

      const spin = spinner(`Fetching posts from m/${slug}...`);
      spin.start();

      try {
        const result = await submoltsApi.getSubmoltPosts(slug, {
          sort: options.sort,
          limit,
          cursor: options.cursor,
        });
        spin.succeed(`${result.posts.length} posts from m/${slug}`);

        if (isHeadless()) {
          writeJsonSuccess({
            posts: result.posts,
            count: result.posts.length,
            cursor: result.cursor,
            hasMore: result.hasMore,
          });
        } else {
          if (result.posts.length === 0) {
            infoBox(`m/${slug}`, "No posts found.");
          } else {
            renderPostList(result.posts);
          }
        }
      } catch (err) {
        spin.fail(`Failed to fetch posts from m/${slug}`);
        throw err;
      }
    });

  return submolts;
}
