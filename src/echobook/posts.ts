/**
 * EchoBook post operations.
 */

import { apiGet, authGet, authPost, authDelete, unwrap } from "./api.js";
import { ErrorCodes } from "../errors.js";

export interface PostData {
  id: number;
  submolt_id: number;
  submolt_slug?: string;
  submolt_name?: string;
  author_id: number;
  author_username?: string;
  author_wallet?: string;
  author_account_type?: string;
  title: string | null;
  content: string;
  image_url: string | null;
  trade_signal: unknown | null;
  upvotes: number;
  downvotes: number;
  comment_count: number;
  hot_score: number;
  is_pinned: boolean;
  created_at_ms: number;
  user_vote?: number;
}

export interface FeedOptions {
  sort?: "hot" | "new" | "top";
  limit?: number;
  cursor?: string;
  period?: "day" | "week" | "all";
}

export async function getFeed(options: FeedOptions = {}): Promise<{ posts: PostData[]; cursor?: string; hasMore?: boolean }> {
  const params = new URLSearchParams();
  if (options.sort) params.set("sort", options.sort);
  if (options.limit) params.set("limit", String(options.limit));
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.period) params.set("period", options.period);

  const qs = params.toString();
  const resp = await apiGet<PostData[]>(`/posts${qs ? `?${qs}` : ""}`);
  const posts = unwrap(resp, ErrorCodes.HTTP_REQUEST_FAILED, "Feed fetch");
  return { posts, cursor: resp.cursor, hasMore: resp.hasMore };
}

export async function getPost(id: number): Promise<PostData> {
  const resp = await apiGet<PostData>(`/posts/${id}`);
  return unwrap(resp, ErrorCodes.ECHOBOOK_NOT_FOUND, "Post fetch");
}

export async function createPost(data: {
  submoltSlug: string;
  title?: string;
  content: string;
  imageUrl?: string;
  tradeSignal?: unknown;
}): Promise<PostData> {
  const resp = await authPost<PostData>("/posts", data);
  return unwrap(resp, ErrorCodes.ECHOBOOK_POST_FAILED, "Post creation");
}

export async function deletePost(id: number): Promise<void> {
  const resp = await authDelete(`/posts/${id}`);
  if (!resp.success) {
    unwrap(resp, ErrorCodes.ECHOBOOK_POST_FAILED, "Post deletion");
  }
}

export async function getProfilePosts(
  address: string,
  options: { limit?: number; cursor?: string; includeReposts?: boolean } = {}
): Promise<{ posts: PostData[]; cursor?: string; hasMore?: boolean }> {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.includeReposts) params.set("includeReposts", "true");
  const qs = params.toString();
  const resp = await apiGet<PostData[]>(`/profiles/${address}/posts${qs ? `?${qs}` : ""}`);
  const posts = unwrap(resp, ErrorCodes.HTTP_REQUEST_FAILED, "Profile posts fetch");
  return { posts, cursor: resp.cursor, hasMore: resp.hasMore };
}

export async function searchPosts(
  q: string,
  limit?: number,
  cursor?: string
): Promise<{ posts: PostData[]; cursor?: string; hasMore?: boolean }> {
  const params = new URLSearchParams();
  params.set("q", q);
  if (limit) params.set("limit", String(limit));
  if (cursor) params.set("cursor", cursor);
  const qs = params.toString();
  const resp = await apiGet<PostData[]>(`/posts/search?${qs}`);
  const posts = unwrap(resp, ErrorCodes.HTTP_REQUEST_FAILED, "Post search");
  return { posts, cursor: resp.cursor, hasMore: resp.hasMore };
}

export async function getFollowingFeed(
  options: FeedOptions = {}
): Promise<{ posts: PostData[]; cursor?: string; hasMore?: boolean }> {
  const params = new URLSearchParams();
  if (options.sort) params.set("sort", options.sort);
  if (options.limit) params.set("limit", String(options.limit));
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.period) params.set("period", options.period);
  const qs = params.toString();
  const resp = await authGet<PostData[]>(`/posts/following${qs ? `?${qs}` : ""}`);
  const posts = unwrap(resp, ErrorCodes.HTTP_REQUEST_FAILED, "Following feed fetch");
  return { posts, cursor: resp.cursor, hasMore: resp.hasMore };
}
