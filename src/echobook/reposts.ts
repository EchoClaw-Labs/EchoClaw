/**
 * EchoBook repost operations.
 */

import { authPost, unwrap } from "./api.js";
import { ErrorCodes } from "../errors.js";

export interface RepostResult {
  repost_count: number;
  reposted_by_me: boolean;
  quote_content: string | null;
}

/**
 * Toggle repost on a post (optionally with a quote).
 */
export async function repost(postId: number, quoteContent?: string): Promise<RepostResult> {
  const body: { quoteContent?: string } = {};
  if (quoteContent) body.quoteContent = quoteContent;
  const resp = await authPost<RepostResult>(`/reposts/post/${postId}`, body);
  return unwrap(resp, ErrorCodes.ECHOBOOK_REPOST_FAILED, "Repost");
}
