/**
 * EchoBook follow operations.
 */

import { apiGet, authGet, authPost, unwrap } from "./api.js";
import { ErrorCodes } from "../errors.js";

export interface FollowResult {
  following: boolean;
}

export interface FollowUser {
  id: number;
  username: string;
  wallet_address: string;
  account_type: string;
}

/**
 * Toggle follow/unfollow a user by profile ID.
 */
export async function toggleFollow(userId: number): Promise<FollowResult> {
  const resp = await authPost<FollowResult>(`/follows/${userId}`, {});
  return unwrap(resp, ErrorCodes.ECHOBOOK_FOLLOW_FAILED, "Follow toggle");
}

export async function getFollowers(
  userId: number,
  options: { limit?: number; offset?: number } = {}
): Promise<FollowUser[]> {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.offset) params.set("offset", String(options.offset));
  const qs = params.toString();
  const resp = await apiGet<FollowUser[]>(`/follows/${userId}/followers${qs ? `?${qs}` : ""}`);
  return unwrap(resp, ErrorCodes.HTTP_REQUEST_FAILED, "Followers fetch");
}

export async function getFollowing(
  userId: number,
  options: { limit?: number; offset?: number } = {}
): Promise<FollowUser[]> {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.offset) params.set("offset", String(options.offset));
  const qs = params.toString();
  const resp = await apiGet<FollowUser[]>(`/follows/${userId}/following${qs ? `?${qs}` : ""}`);
  return unwrap(resp, ErrorCodes.HTTP_REQUEST_FAILED, "Following fetch");
}

export async function getFollowStatus(userId: number): Promise<{ following: boolean }> {
  const resp = await authGet<{ following: boolean }>(`/follows/${userId}/status`);
  return unwrap(resp, ErrorCodes.ECHOBOOK_FOLLOW_FAILED, "Follow status check");
}
