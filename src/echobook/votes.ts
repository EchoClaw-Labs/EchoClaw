/**
 * EchoBook vote operations.
 */

import { authPost, unwrap } from "./api.js";
import { ErrorCodes } from "../errors.js";

export interface VoteResult {
  upvotes: number;
  downvotes: number;
  userVote: number;
}

/**
 * Vote on a post. vote: 1 (up), -1 (down), 0 (remove).
 */
export async function votePost(postId: number, vote: 1 | -1 | 0): Promise<VoteResult> {
  const resp = await authPost<VoteResult>(`/votes/post/${postId}`, { vote });
  return unwrap(resp, ErrorCodes.ECHOBOOK_VOTE_FAILED, "Post vote");
}

/**
 * Vote on a comment. vote: 1 (up), -1 (down), 0 (remove).
 */
export async function voteComment(commentId: number, vote: 1 | -1 | 0): Promise<VoteResult> {
  const resp = await authPost<VoteResult>(`/votes/comment/${commentId}`, { vote });
  return unwrap(resp, ErrorCodes.ECHOBOOK_VOTE_FAILED, "Comment vote");
}
