import { type FC, useEffect, useState, useCallback } from "react";
import { getSoul, getMemory, getFiles, getFile, getSessions, getSessionMessages, getSkillReferences, getSkillContent } from "../api";
import type { FileTreeEntry, SessionListEntry } from "../types";

interface MemoryViewProps {
  onBack: () => void;
}

type TabKey = "soul" | "memory" | "files" | "sessions" | "skills";

export const MemoryView: FC<MemoryViewProps> = ({ onBack }) => {
  const [tab, setTab] = useState<TabKey>("soul");
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<FileTreeEntry[]>([]);
  const [sessions, setSessions] = useState<SessionListEntry[]>([]);
  const [skillRefs, setSkillRefs] = useState<Array<{ path: string; sizeBytes: number }>>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState("");

  const loadTab = useCallback(async () => {
    setSelectedFile(null);
    setFileContent(null);
    try {
      if (tab === "soul") {
        const res = await getSoul();
        setContent(res.content ?? "(No soul.md yet — start a conversation first)");
      } else if (tab === "memory") {
        const res = await getMemory();
        setContent(res.content || "(Empty memory.md)");
      } else if (tab === "files") {
        setCurrentPath("");
        const res = await getFiles("");
        setFiles(res.entries);
      } else if (tab === "sessions") {
        const res = await getSessions();
        setSessions(res.sessions);
      } else if (tab === "skills") {
        const res = await getSkillReferences();
        setSkillRefs(res.references);
      }
    } catch (err) {
      setContent(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [tab]);

  useEffect(() => {
    const ac = new AbortController();
    loadTab();
    return () => ac.abort();
  }, [loadTab]);

  const navigateDir = async (dirPath: string) => {
    setCurrentPath(dirPath);
    try {
      const res = await getFiles(dirPath);
      setFiles(res.entries);
    } catch (err) { console.warn("[MemoryView] dir navigate failed:", err); setFiles([]); }
  };

  const openFile = async (path: string) => {
    setSelectedFile(path);
    try {
      const res = await getFile(path);
      setFileContent(res.content);
    } catch (err) { console.warn("[MemoryView] file load failed:", err); setFileContent("Failed to load file."); }
  };

  const openSkill = async (path: string) => {
    setSelectedFile(path);
    try {
      const res = await getSkillContent(path);
      setFileContent(res.content);
    } catch (err) { console.warn("[MemoryView] skill load failed:", err); setFileContent("Failed to load skill reference."); }
  };

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "soul", label: "Soul" },
    { key: "memory", label: "Memory" },
    { key: "files", label: "Knowledge" },
    { key: "skills", label: "Skills" },
    { key: "sessions", label: "Sessions" },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-4 px-4 py-3 border-b border-border">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground text-sm transition">&larr;</button>
        <h2 className="text-sm font-semibold text-foreground">Agent Memory</h2>
      </div>

      <div className="flex gap-1 px-4 py-2 border-b border-border flex-wrap">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-xs rounded-lg transition ${tab === t.key ? "bg-accent/20 text-accent" : "text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Soul / Memory — plain text */}
        {(tab === "soul" || tab === "memory") && (
          <pre className="text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed">{content}</pre>
        )}

        {/* Knowledge files — with directory navigation */}
        {tab === "files" && !selectedFile && (
          <div className="space-y-1">
            {/* Breadcrumb */}
            {currentPath && (
              <button onClick={() => {
                const parent = currentPath.split("/").slice(0, -1).join("/");
                navigateDir(parent);
              }} className="text-xs text-muted-foreground hover:text-foreground mb-2 block">
                &larr; {currentPath || "/"}
              </button>
            )}
            {files.length === 0 && <p className="text-sm text-muted-foreground">No files here.</p>}
            {files.map(f => (
              <button key={f.path}
                onClick={() => f.type === "dir" ? navigateDir(f.path) : openFile(f.path)}
                className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg hover:bg-card transition">
                <span className="text-xs text-muted-foreground">{f.type === "dir" ? "▸" : "·"}</span>
                <span className="text-sm text-foreground flex-1">{f.name}</span>
                {f.sizeBytes != null && f.type === "file" && <span className="text-2xs text-muted-foreground">{(f.sizeBytes / 1024).toFixed(1)}kb</span>}
              </button>
            ))}
          </div>
        )}

        {tab === "files" && selectedFile && (
          <div>
            <button onClick={() => { setSelectedFile(null); setFileContent(null); }} className="text-xs text-muted-foreground hover:text-foreground mb-3">&larr; {selectedFile}</button>
            <pre className="text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed">{fileContent}</pre>
          </div>
        )}

        {/* Skills — packaged reference files */}
        {tab === "skills" && !selectedFile && (
          <div className="space-y-1">
            {skillRefs.length === 0 && <p className="text-sm text-muted-foreground">No skill references loaded.</p>}
            {skillRefs.map(r => (
              <button key={r.path} onClick={() => openSkill(r.path)}
                className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg hover:bg-card transition">
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-sm text-foreground flex-1 font-mono">{r.path}</span>
                <span className="text-2xs text-muted-foreground">{(r.sizeBytes / 1024).toFixed(1)}kb</span>
              </button>
            ))}
          </div>
        )}

        {tab === "skills" && selectedFile && (
          <div>
            <button onClick={() => { setSelectedFile(null); setFileContent(null); }} className="text-xs text-muted-foreground hover:text-foreground mb-3">&larr; {selectedFile}</button>
            <pre className="text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed">{fileContent}</pre>
          </div>
        )}

        {/* Sessions */}
        {tab === "sessions" && !selectedFile && (
          <div className="space-y-1">
            {sessions.length === 0 && <p className="text-sm text-muted-foreground">No sessions yet.</p>}
            {sessions.map(s => (
              <button key={s.id} onClick={async () => {
                setSelectedFile(s.id);
                try {
                  const res = await getSessionMessages(s.id);
                  const msgs = Array.isArray(res.messages) ? res.messages : [];
                  const formatted = msgs.map(m =>
                    `[${(m.role ?? "unknown").toUpperCase()}] ${(m.content ?? "").slice(0, 500)}`
                  ).join("\n\n---\n\n");
                  setFileContent(formatted || "(Empty session)");
                } catch (err) { console.warn("[MemoryView] session load failed:", err); setFileContent("Failed to load session."); }
              }}
                className="flex items-center gap-3 w-full text-left px-3 py-2 rounded-lg hover:bg-card transition">
                <span className="text-sm text-foreground flex-1 font-mono">{s.id}</span>
                <span className="text-2xs text-muted-foreground">{(s.startedAt ?? "").slice(0, 16) || "unknown"}</span>
              </button>
            ))}
          </div>
        )}

        {tab === "sessions" && selectedFile && (
          <div>
            <button onClick={() => { setSelectedFile(null); setFileContent(null); }} className="text-xs text-muted-foreground hover:text-foreground mb-3">&larr; Back to sessions</button>
            <pre className="text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed">{fileContent}</pre>
          </div>
        )}
      </div>
    </div>
  );
};
