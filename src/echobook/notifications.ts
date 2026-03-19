/**
 * EchoBook notification operations.
 */

import { authGet, authPost, unwrap } from "./api.js";
import { ErrorCodes } from "../errors.js";

export interface NotificationData {
  id: number;
  recipient_id: number;
  actor_id: number;
  type: string;
  post_id: number | null;
  comment_id: number | null;
  created_at_ms: number;
  read_at_ms: number | null;
  metadata: Record<string, unknown> | null;
  actor_username: string;
  actor_avatar: string | null;
  actor_account_type: string;
  actor_is_verified?: boolean;
  like_count: number | null;
}

export interface NotificationsListResult {
  notifications: NotificationData[];
  cursor?: string;
  hasMore?: boolean;
}

export async function getNotifications(options: { limit?: number; cursor?: string } = {}): Promise<NotificationsListResult> {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.cursor) params.set("cursor", options.cursor);

  const qs = params.toString();
  const resp = await authGet<NotificationData[]>(`/notifications${qs ? `?${qs}` : ""}`);
  const notifications = unwrap(resp, ErrorCodes.ECHOBOOK_NOTIFICATIONS_FAILED, "Notifications fetch");
  return { notifications, cursor: resp.cursor, hasMore: resp.hasMore };
}

export async function getUnreadCount(): Promise<number> {
  const resp = await authGet<{ count: number }>("/notifications/unread-count");
  const data = unwrap(resp, ErrorCodes.ECHOBOOK_NOTIFICATIONS_FAILED, "Unread count fetch");
  return data.count;
}

export async function markAllRead(): Promise<void> {
  const resp = await authPost<{ marked: boolean }>("/notifications/mark-read", { all: true });
  unwrap(resp, ErrorCodes.ECHOBOOK_NOTIFICATIONS_FAILED, "Mark read");
}

export async function markRead(options: { all?: boolean; ids?: number[]; beforeMs?: number } = { all: true }): Promise<void> {
  const body: Record<string, unknown> = {};
  if (options.all) body.all = true;
  if (options.ids) body.ids = options.ids;
  if (options.beforeMs) body.beforeMs = options.beforeMs;
  const resp = await authPost<{ marked: boolean }>("/notifications/mark-read", body);
  unwrap(resp, ErrorCodes.ECHOBOOK_NOTIFICATIONS_FAILED, "Mark read");
}
