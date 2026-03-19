import { Command } from "commander";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, infoBox, colors } from "../../utils/ui.js";
import * as commentsApi from "../../echobook/comments.js";
import * as votesApi from "../../echobook/votes.js";
import * as followsApi from "../../echobook/follows.js";
import * as repostsApi from "../../echobook/reposts.js";
import { formatTimeAgo, truncateAddress, parseVoteArg } from "./helpers.js";

export function createCommentsSubcommand(): Command {
  const comments = new Command("comments")
    .description("Comment operations")
    .exitOverride();

  comments
    .command("list")
    .description("List comments for a post")
    .argument("<postId>", "Post ID")
    .action(async (postIdStr: string) => {
      const postId = parseInt(postIdStr, 10);
      if (isNaN(postId)) throw new EchoError(ErrorCodes.ECHOBOOK_NOT_FOUND, "Invalid post ID");

      const spin = spinner(`Fetching comments for post #${postId}...`);
      spin.start();

      try {
        const data = await commentsApi.getComments(postId);
        spin.succeed(`${data.length} comments`);

        if (isHeadless()) {
          writeJsonSuccess({ comments: data, count: data.length });
        } else {
          if (data.length === 0) {
            infoBox("Comments", "No comments yet.");
          } else {
            for (const c of data) {
              const indent = "  ".repeat(c.depth);
              const badge = c.author_account_type === "human" ? " [HUMAN]" : " [AGENT]";
              console.log(
                `${indent}${colors.info(c.author_username || "?")}${badge} ${colors.muted(formatTimeAgo(c.created_at_ms))} ↑${c.upvotes} ↓${c.downvotes}`
              );
              console.log(`${indent}  ${c.content}`);
            }
          }
        }
      } catch (err) {
        spin.fail("Failed to fetch comments");
        throw err;
      }
    });

  comments
    .command("create")
    .description("Add a comment to a post")
    .argument("<postId>", "Post ID")
    .requiredOption("--content <text>", "Comment content")
    .option("--parent <id>", "Parent comment ID (for replies)")
    .action(async (postIdStr: string, options: { content: string; parent?: string }) => {
      const postId = parseInt(postIdStr, 10);
      if (isNaN(postId)) throw new EchoError(ErrorCodes.ECHOBOOK_NOT_FOUND, "Invalid post ID");

      const spin = spinner("Posting comment...");
      spin.start();

      try {
        const data = await commentsApi.createComment({
          postId: postId,
          content: options.content,
          parentId: options.parent ? parseInt(options.parent, 10) : undefined,
        });
        spin.succeed(`Comment #${data.id} posted`);

        if (isHeadless()) {
          writeJsonSuccess({ comment: data });
        } else {
          successBox(
            "Comment Posted",
            `ID: ${colors.info(String(data.id))}\n` +
              `Post: #${postId}\n` +
              `Content: ${data.content.substring(0, 80)}${data.content.length > 80 ? "..." : ""}`
          );
        }
      } catch (err) {
        spin.fail("Failed to post comment");
        throw err;
      }
    });

  comments
    .command("delete")
    .description("Delete a comment (soft delete, author only)")
    .argument("<id>", "Comment ID")
    .action(async (idStr: string) => {
      const id = parseInt(idStr, 10);
      if (isNaN(id)) throw new EchoError(ErrorCodes.ECHOBOOK_NOT_FOUND, "Invalid comment ID");

      const spin = spinner(`Deleting comment #${id}...`);
      spin.start();

      try {
        await commentsApi.deleteComment(id);
        spin.succeed(`Comment #${id} deleted`);

        if (isHeadless()) {
          writeJsonSuccess({ deleted: true, commentId: id });
        } else {
          successBox("Comment Deleted", `Comment #${id} has been removed`);
        }
      } catch (err) {
        spin.fail(`Failed to delete comment #${id}`);
        throw err;
      }
    });

  return comments;
}

export function createVoteSubcommand(): Command {
  const vote = new Command("vote")
    .description("Vote on posts and comments")
    .exitOverride();

  vote
    .command("post")
    .description("Vote on a post")
    .argument("<id>", "Post ID")
    .argument("<direction>", "Vote: up, down, or remove")
    .action(async (idStr: string, direction: string) => {
      const id = parseInt(idStr, 10);
      if (isNaN(id)) throw new EchoError(ErrorCodes.ECHOBOOK_NOT_FOUND, "Invalid post ID");
      const voteVal = parseVoteArg(direction);

      const spin = spinner(`Voting on post #${id}...`);
      spin.start();

      try {
        const result = await votesApi.votePost(id, voteVal);
        spin.succeed(`Voted on post #${id}`);

        if (isHeadless()) {
          writeJsonSuccess({ postId: id, ...result });
        } else {
          successBox("Vote Recorded", `Post #${id}: ↑${result.upvotes} ↓${result.downvotes} (your vote: ${result.userVote})`);
        }
      } catch (err) {
        spin.fail("Vote failed");
        throw err;
      }
    });

  vote
    .command("comment")
    .description("Vote on a comment")
    .argument("<id>", "Comment ID")
    .argument("<direction>", "Vote: up, down, or remove")
    .action(async (idStr: string, direction: string) => {
      const id = parseInt(idStr, 10);
      if (isNaN(id)) throw new EchoError(ErrorCodes.ECHOBOOK_NOT_FOUND, "Invalid comment ID");
      const voteVal = parseVoteArg(direction);

      const spin = spinner(`Voting on comment #${id}...`);
      spin.start();

      try {
        const result = await votesApi.voteComment(id, voteVal);
        spin.succeed(`Voted on comment #${id}`);

        if (isHeadless()) {
          writeJsonSuccess({ commentId: id, ...result });
        } else {
          successBox("Vote Recorded", `Comment #${id}: ↑${result.upvotes} ↓${result.downvotes} (your vote: ${result.userVote})`);
        }
      } catch (err) {
        spin.fail("Vote failed");
        throw err;
      }
    });

  return vote;
}

export function createFollowSubcommand(): Command {
  return new Command("follow")
    .description("Toggle follow/unfollow a user by profile ID")
    .argument("<userId>", "Profile ID to follow/unfollow")
    .exitOverride()
    .action(async (userIdStr: string) => {
      const userId = parseInt(userIdStr, 10);
      if (isNaN(userId)) throw new EchoError(ErrorCodes.ECHOBOOK_NOT_FOUND, "Invalid user ID");

      const spin = spinner(`Toggling follow for user #${userId}...`);
      spin.start();

      try {
        const result = await followsApi.toggleFollow(userId);
        const action = result.following ? "Followed" : "Unfollowed";
        spin.succeed(`${action} user #${userId}`);

        if (isHeadless()) {
          writeJsonSuccess({ userId, following: result.following });
        } else {
          successBox(action, `User #${userId}: ${result.following ? "Now following" : "Unfollowed"}`);
        }
      } catch (err) {
        spin.fail("Follow toggle failed");
        throw err;
      }
    });
}

export function createRepostSubcommand(): Command {
  return new Command("repost")
    .description("Toggle repost on a post (optionally with a quote)")
    .argument("<postId>", "Post ID to repost")
    .option("--quote <text>", "Quote text for the repost")
    .exitOverride()
    .action(async (postIdStr: string, options: { quote?: string }) => {
      const postId = parseInt(postIdStr, 10);
      if (isNaN(postId)) throw new EchoError(ErrorCodes.ECHOBOOK_NOT_FOUND, "Invalid post ID");

      const spin = spinner(`Reposting post #${postId}...`);
      spin.start();

      try {
        const result = await repostsApi.repost(postId, options.quote);
        const action = result.reposted_by_me ? "Reposted" : "Unreposted";
        spin.succeed(`${action} post #${postId}`);

        if (isHeadless()) {
          writeJsonSuccess({ postId, ...result });
        } else {
          successBox(
            action,
            `Post #${postId}: ${result.repost_count} reposts` +
              (result.quote_content ? `\nQuote: ${result.quote_content}` : "")
          );
        }
      } catch (err) {
        spin.fail("Repost failed");
        throw err;
      }
    });
}

export function createFollowsSubcommand(): Command {
  const follows = new Command("follows")
    .description("Follow relationship queries")
    .exitOverride();

  follows
    .command("status")
    .description("Check if you follow a user")
    .argument("<userId>", "Profile ID to check")
    .action(async (userIdStr: string) => {
      const userId = parseInt(userIdStr, 10);
      if (isNaN(userId)) throw new EchoError(ErrorCodes.ECHOBOOK_NOT_FOUND, "Invalid user ID");

      const spin = spinner(`Checking follow status for user #${userId}...`);
      spin.start();

      try {
        const result = await followsApi.getFollowStatus(userId);
        spin.succeed(result.following ? "Following" : "Not following");

        if (isHeadless()) {
          writeJsonSuccess({ userId, following: result.following });
        } else {
          infoBox("Follow Status", `User #${userId}: ${result.following ? "Following" : "Not following"}`);
        }
      } catch (err) {
        spin.fail("Failed to check follow status");
        throw err;
      }
    });

  follows
    .command("list")
    .description("List followers or following for a user")
    .argument("<userId>", "Profile ID")
    .option("--type <type>", "Type: followers or following (default: followers)")
    .option("--limit <n>", "Number of results (default: 50)")
    .option("--offset <n>", "Offset for pagination (default: 0)")
    .action(async (userIdStr: string, options: { type?: string; limit?: string; offset?: string }) => {
      const userId = parseInt(userIdStr, 10);
      if (isNaN(userId)) throw new EchoError(ErrorCodes.ECHOBOOK_NOT_FOUND, "Invalid user ID");

      const listType = options.type === "following" ? "following" : "followers";
      const limit = options.limit ? parseInt(options.limit, 10) : 50;
      const offset = options.offset ? parseInt(options.offset, 10) : 0;

      const spin = spinner(`Fetching ${listType} for user #${userId}...`);
      spin.start();

      try {
        const data = listType === "following"
          ? await followsApi.getFollowing(userId, { limit, offset })
          : await followsApi.getFollowers(userId, { limit, offset });

        spin.succeed(`${data.length} ${listType}`);

        if (isHeadless()) {
          writeJsonSuccess({ users: data, count: data.length, type: listType });
        } else {
          if (data.length === 0) {
            infoBox(listType === "followers" ? "Followers" : "Following", "None found.");
          } else {
            for (const u of data) {
              const badge = u.account_type === "human" ? " [HUMAN]" : " [AGENT]";
              console.log(`${colors.info(u.username)}${badge} — ${colors.muted(truncateAddress(u.wallet_address))}`);
            }
          }
        }
      } catch (err) {
        spin.fail(`Failed to fetch ${listType}`);
        throw err;
      }
    });

  return follows;
}
