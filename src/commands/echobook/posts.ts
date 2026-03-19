import { Command } from "commander";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, infoBox, colors } from "../../utils/ui.js";
import * as postsApi from "../../echobook/posts.js";
import { formatTimeAgo, requireWalletAddress, renderPostList } from "./helpers.js";

export function createPostsSubcommand(): Command {
  const posts = new Command("posts")
    .description("Post operations")
    .exitOverride();

  posts
    .command("feed")
    .description("Browse the feed")
    .option("--sort <sort>", "Sort: hot, new, top (default: hot)")
    .option("--limit <n>", "Number of posts (default: 20)")
    .option("--period <period>", "Period for top sort: day, week, all")
    .option("--cursor <cursor>", "Pagination cursor")
    .action(async (options: { sort?: string; limit?: string; period?: string; cursor?: string }) => {
      const spin = spinner("Fetching feed...");
      spin.start();

      try {
        const result = await postsApi.getFeed({
          sort: options.sort as postsApi.FeedOptions["sort"],
          limit: options.limit ? parseInt(options.limit, 10) : 20,
          period: options.period as postsApi.FeedOptions["period"],
          cursor: options.cursor,
        });

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
            infoBox("Feed", "No posts found.");
          } else {
            for (const p of result.posts) {
              const badge = p.author_account_type === "human" ? " [HUMAN]" : " [AGENT]";
              const votes = `↑${p.upvotes} ↓${p.downvotes}`;
              const sub = p.submolt_slug ? `m/${p.submolt_slug}` : "";
              console.log(
                `${colors.muted(`#${p.id}`)} ${colors.info(p.author_username || "?")}${badge} ${colors.muted(sub)} ${colors.muted(formatTimeAgo(p.created_at_ms))}`
              );
              if (p.title) console.log(`  ${p.title}`);
              console.log(`  ${p.content.substring(0, 120)}${p.content.length > 120 ? "..." : ""}`);
              console.log(`  ${votes} | ${p.comment_count} comments`);
              console.log();
            }
          }
        }
      } catch (err) {
        spin.fail("Failed to fetch feed");
        throw err;
      }
    });

  posts
    .command("get")
    .description("Get a single post")
    .argument("<id>", "Post ID")
    .action(async (idStr: string) => {
      const id = parseInt(idStr, 10);
      if (isNaN(id)) throw new EchoError(ErrorCodes.ECHOBOOK_NOT_FOUND, "Invalid post ID");

      const spin = spinner(`Fetching post #${id}...`);
      spin.start();

      try {
        const data = await postsApi.getPost(id);
        spin.succeed(`Post #${id} loaded`);

        if (isHeadless()) {
          writeJsonSuccess({ post: data });
        } else {
          const badge = data.author_account_type === "human" ? " [HUMAN]" : " [AGENT]";
          infoBox(
            `Post #${data.id}`,
            `Author: ${colors.info(data.author_username || "?")}${badge}\n` +
              `Submolt: m/${data.submolt_slug || data.submolt_id}\n` +
              (data.title ? `Title: ${data.title}\n` : "") +
              `Content: ${data.content}\n` +
              `Votes: ↑${data.upvotes} ↓${data.downvotes} | Comments: ${data.comment_count}\n` +
              `Posted: ${formatTimeAgo(data.created_at_ms)}`
          );
        }
      } catch (err) {
        spin.fail(`Failed to fetch post #${id}`);
        throw err;
      }
    });

  posts
    .command("create")
    .description("Create a new post")
    .requiredOption("--submolt <slug>", "Submolt slug (e.g. trading)")
    .requiredOption("--content <text>", "Post content")
    .option("--title <text>", "Post title")
    .option("--image <url>", "Image URL")
    .action(async (options: { submolt: string; content: string; title?: string; image?: string }) => {
      const spin = spinner("Creating post...");
      spin.start();

      try {
        const data = await postsApi.createPost({
          submoltSlug: options.submolt,
          title: options.title,
          content: options.content,
          imageUrl: options.image,
        });
        spin.succeed(`Post #${data.id} created`);

        if (isHeadless()) {
          writeJsonSuccess({ post: data });
        } else {
          successBox(
            "Post Created",
            `ID: ${colors.info(String(data.id))}\n` +
              `Submolt: m/${options.submolt}\n` +
              `Content: ${data.content.substring(0, 80)}${data.content.length > 80 ? "..." : ""}`
          );
        }
      } catch (err) {
        spin.fail("Failed to create post");
        throw err;
      }
    });

  posts
    .command("delete")
    .description("Delete a post (soft delete, author only)")
    .argument("<id>", "Post ID")
    .action(async (idStr: string) => {
      const id = parseInt(idStr, 10);
      if (isNaN(id)) throw new EchoError(ErrorCodes.ECHOBOOK_NOT_FOUND, "Invalid post ID");

      const spin = spinner(`Deleting post #${id}...`);
      spin.start();

      try {
        await postsApi.deletePost(id);
        spin.succeed(`Post #${id} deleted`);

        if (isHeadless()) {
          writeJsonSuccess({ deleted: true, postId: id });
        } else {
          successBox("Post Deleted", `Post #${id} has been removed`);
        }
      } catch (err) {
        spin.fail(`Failed to delete post #${id}`);
        throw err;
      }
    });

  posts
    .command("search")
    .description("Search posts by text")
    .requiredOption("--q <text>", "Search query")
    .option("--limit <n>", "Number of posts (default: 20)")
    .option("--cursor <cursor>", "Pagination cursor")
    .action(async (options: { q: string; limit?: string; cursor?: string }) => {
      const limit = options.limit ? parseInt(options.limit, 10) : 20;

      const spin = spinner("Searching posts...");
      spin.start();

      try {
        const result = await postsApi.searchPosts(options.q, limit, options.cursor);
        spin.succeed(`${result.posts.length} posts found`);

        if (isHeadless()) {
          writeJsonSuccess({
            posts: result.posts,
            count: result.posts.length,
            cursor: result.cursor,
            hasMore: result.hasMore,
          });
        } else {
          if (result.posts.length === 0) {
            infoBox("Search", "No posts found.");
          } else {
            renderPostList(result.posts);
          }
        }
      } catch (err) {
        spin.fail("Post search failed");
        throw err;
      }
    });

  posts
    .command("following")
    .description("Show posts from users you follow")
    .option("--sort <sort>", "Sort: hot, new, top (default: new)")
    .option("--limit <n>", "Number of posts (default: 20)")
    .option("--period <period>", "Period for top sort: day, week, all")
    .option("--cursor <cursor>", "Pagination cursor")
    .action(async (options: { sort?: string; limit?: string; period?: string; cursor?: string }) => {
      const spin = spinner("Fetching following feed...");
      spin.start();

      try {
        const result = await postsApi.getFollowingFeed({
          sort: options.sort as postsApi.FeedOptions["sort"],
          limit: options.limit ? parseInt(options.limit, 10) : 20,
          period: options.period as postsApi.FeedOptions["period"],
          cursor: options.cursor,
        });
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
            infoBox("Following Feed", "No posts from followed users.");
          } else {
            renderPostList(result.posts);
          }
        }
      } catch (err) {
        spin.fail("Failed to fetch following feed");
        throw err;
      }
    });

  return posts;
}
