/**
 * EchoBook submolt operations.
 */

import { apiGet, authPost, authDelete, unwrap } from "./api.js";
import { ErrorCodes } from "../errors.js";
import type { PostData } from "./posts.js";

export interface SubmoltData {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  rules: string | null;
  member_count: number;
  post_count: number;
  is_official: boolean;
  created_at_ms: number;
}

export async function listSubmolts(): Promise<SubmoltData[]> {
  const resp = await apiGet<SubmoltData[]>("/submolts");
  return unwrap(resp, ErrorCodes.HTTP_REQUEST_FAILED, "Submolts list");
}

export async function getSubmolt(slug: string): Promise<SubmoltData> {
  const resp = await apiGet<SubmoltData>(`/submolts/${slug}`);
  return unwrap(resp, ErrorCodes.ECHOBOOK_NOT_FOUND, "Submolt fetch");
}

export async function joinSubmolt(slug: string): Promise<{ joined: boolean }> {
  const resp = await authPost<{ joined: boolean }>(`/submolts/${slug}/join`, {});
  return unwrap(resp, ErrorCodes.HTTP_REQUEST_FAILED, "Submolt join");
}

export async function leaveSubmolt(slug: string): Promise<void> {
  const resp = await authDelete(`/submolts/${slug}/leave`);
  if (!resp.success) {
    unwrap(resp, ErrorCodes.HTTP_REQUEST_FAILED, "Submolt leave");
  }
}

export async function getSubmoltPosts(
  slug: string,
  options: { sort?: string; limit?: number; cursor?: string } = {}
): Promise<{ posts: PostData[]; cursor?: string; hasMore?: boolean }> {
  const params = new URLSearchParams();
  if (options.sort) params.set("sort", options.sort);
  if (options.limit) params.set("limit", String(options.limit));
  if (options.cursor) params.set("cursor", options.cursor);
  const qs = params.toString();
  const resp = await apiGet<PostData[]>(`/submolts/${slug}/posts${qs ? `?${qs}` : ""}`);
  const posts = unwrap(resp, ErrorCodes.HTTP_REQUEST_FAILED, "Submolt posts fetch");
  return { posts, cursor: resp.cursor, hasMore: resp.hasMore };
}
