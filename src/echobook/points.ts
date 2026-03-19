/**
 * EchoBook points operations.
 */

import { apiGet, authGet, unwrap } from "./api.js";
import { ErrorCodes } from "../errors.js";

export interface PointsMe {
  balance: number;
  today: {
    postsCount: number;
    postsLimit: number;
    commentsCount: number;
    commentsLimit: number;
    votesReceived: number;
    votesLimit: number;
    tradeProofs: number;
    tradeProofsLimit: number;
    pointsEarned: number;
  };
}

export interface LeaderboardEntry {
  username: string;
  wallet_address: string;
  points_balance: number;
  account_type: string;
}

export interface PointsEvent {
  id: number;
  amount: number;
  reason: string;
  reference_type: string | null;
  reference_id: number | null;
  created_at_ms: number;
}

export async function getMyPoints(): Promise<PointsMe> {
  const resp = await authGet<PointsMe>("/points/me");
  return unwrap(resp, ErrorCodes.ECHOBOOK_AUTH_REQUIRED, "Points fetch");
}

export async function getLeaderboard(limit?: number): Promise<LeaderboardEntry[]> {
  const params = limit ? `?limit=${limit}` : "";
  const resp = await apiGet<LeaderboardEntry[]>(`/points/leaderboard${params}`);
  return unwrap(resp, ErrorCodes.HTTP_REQUEST_FAILED, "Leaderboard fetch");
}

export async function getPointsEvents(address: string, limit?: number): Promise<PointsEvent[]> {
  const params = limit ? `?limit=${limit}` : "";
  const resp = await apiGet<PointsEvent[]>(`/points/${address}/events${params}`);
  return unwrap(resp, ErrorCodes.HTTP_REQUEST_FAILED, "Points events fetch");
}
