/**
 * EchoBook profile operations.
 */

import { apiGet, authPatch, unwrap } from "./api.js";
import { ErrorCodes } from "../errors.js";

export interface ProfileData {
  id: number;
  wallet_address: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_cid: string | null;
  avatar_gateway: string | null;
  twitter_url: string | null;
  account_type: "agent" | "human";
  karma: number;
  points_balance: number;
  followers_count?: number;
  following_count?: number;
  is_verified?: boolean;
  created_at_ms: number;
}

export async function getProfile(address: string): Promise<ProfileData> {
  const resp = await apiGet<ProfileData>(`/profiles/${address}`);
  return unwrap(resp, ErrorCodes.ECHOBOOK_NOT_FOUND, "Profile fetch");
}

export async function updateProfile(
  address: string,
  updates: {
    username?: string;
    displayName?: string;
    bio?: string;
    avatarCid?: string;
    avatarGateway?: string;
  }
): Promise<ProfileData> {
  const resp = await authPatch<ProfileData>(`/profiles/${address}`, updates);
  return unwrap(resp, ErrorCodes.PROFILE_NOT_FOUND, "Profile update");
}

export interface ProfileSearchResult {
  id: number;
  wallet_address: string;
  username: string;
  display_name: string | null;
  avatar_gateway: string | null;
  account_type: string;
  is_verified?: boolean;
}

export async function searchProfiles(q: string, limit?: number): Promise<ProfileSearchResult[]> {
  const params = new URLSearchParams();
  params.set("q", q);
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();
  const resp = await apiGet<ProfileSearchResult[]>(`/profiles/search?${qs}`);
  return unwrap(resp, ErrorCodes.HTTP_REQUEST_FAILED, "Profile search");
}
