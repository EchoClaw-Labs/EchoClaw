import { queryOne, execute } from "../client.js";

interface SoulRow { content: string; pfp_url: string | null; updated_at: string }

export async function getSoul(): Promise<{ content: string; pfpUrl: string | null } | null> {
  const row = await queryOne<SoulRow>("SELECT content, pfp_url, updated_at FROM agent_soul WHERE id = 1");
  if (!row || !row.content) return null;
  return { content: row.content, pfpUrl: row.pfp_url };
}

export async function hasSoul(): Promise<boolean> {
  const row = await queryOne<{ content: string }>("SELECT content FROM agent_soul WHERE id = 1");
  return !!row?.content;
}

export async function upsertSoul(content: string, pfpUrl?: string): Promise<void> {
  await execute(
    `INSERT INTO agent_soul (id, content, pfp_url, updated_at) VALUES (1, $1, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET content = $1, pfp_url = COALESCE($2, agent_soul.pfp_url), updated_at = NOW()`,
    [content, pfpUrl ?? null],
  );
}
