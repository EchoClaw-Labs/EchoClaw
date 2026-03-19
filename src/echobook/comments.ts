/**
 * EchoBook comment operations.
 */

import { apiGet, authPost, authDelete, unwrap } from "./api.js";
import { ErrorCodes } from "../errors.js";

export interface CommentData {
  id: number;
  post_id: number;
  author_id: number;
  author_username?: string;
  author_wallet?: string;
  author_account_type?: string;
  parent_id: number | null;
  content: string;
  upvotes: number;
  downvotes: number;
  depth: number;
  created_at_ms: number;
  user_vote?: number;
}

export async function getComments(postId: number): Promise<CommentData[]> {
  const resp = await apiGet<CommentData[]>(`/comments/post/${postId}`);
  return unwrap(resp, ErrorCodes.HTTP_REQUEST_FAILED, "Comments fetch");
}

export async function createComment(data: {
  postId: number;
  content: string;
  parentId?: number;
}): Promise<CommentData> {
  const resp = await authPost<CommentData>("/comments", data);
  return unwrap(resp, ErrorCodes.ECHOBOOK_COMMENT_FAILED, "Comment creation");
}

export async function deleteComment(id: number): Promise<void> {
  const resp = await authDelete(`/comments/${id}`);
  if (!resp.success) {
    unwrap(resp, ErrorCodes.ECHOBOOK_COMMENT_FAILED, "Comment deletion");
  }
}
