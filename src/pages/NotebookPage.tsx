import { useCallback, useEffect, useState } from "react";

import {
  fetchNotebook,
  removeFromNotebook,
  resolveEntries,
  type NotebookItem,
} from "../lib/api";
import type { Entry } from "../lib/types";

interface NotebookPageProps {
  /** Study the notebook's words directly, without a wordbook picker. */
  onStart: (entryIds: string[]) => void;
  onRefresh: () => void;
}

/** The learner's saved words. */
export default function NotebookPage({ onStart, onRefresh }: NotebookPageProps) {
  const [items, setItems] = useState<NotebookItem[]>([]);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [loading, setLoading] = useState(true);

  /** Load the notebook and resolve each word's definition. */
  const load = useCallback(async () => {
    setLoading(true);
    const list = await fetchNotebook();
    setItems(list);

    // The notebook stores entry ids; resolve the details for display.
    const resolved = await resolveEntries(list.map((item) => item.entryId));
    const map: Record<string, Entry> = {};
    for (const entry of resolved) {
      map[entry.id] = entry;
    }
    setEntries(map);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Remove a word from the notebook. */
  const remove = async (entryId: string) => {
    await removeFromNotebook(entryId);
    setItems((prev) => prev.filter((item) => item.entryId !== entryId));
    onRefresh();
  };

  if (loading) {
    return (
      <div className="empty">
        <div className="empty__title">正在读取生词本…</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
        <div>
          <h2 className="section-title">已收录 {items.length} 词</h2>
          <p className="section-subtitle">答错不会自动收录，只有主动点「加入生词本」才会进来。</p>
        </div>
        <div style={{ flex: 1 }} />
        {items.length > 0 && (
          <button
            type="button"
            className="button button--primary"
            onClick={() => onStart(items.map((item) => item.entryId))}
          >
            复习生词
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="empty">
          <div className="empty__title">生词本还是空的</div>
          <p style={{ margin: 0 }}>在练习页点「加入生词本」，就会出现在这里。</p>
        </div>
      ) : (
        <div className="card">
          <div className="card__body">
            <div className="list">
              {items.map((item) => {
                const entry = entries[item.entryId];
                return (
                  <div className="list__row" key={item.entryId}>
                    <span className="word" style={{ width: 200, fontSize: 15 }}>
                      {entry?.word ?? item.entryId.split(":").slice(1).join(":")}
                    </span>
                    <span className="gloss" style={{ flex: 1, color: "var(--ink-muted)" }}>
                      {entry?.meaning ?? "—"}
                    </span>
                    {item.wrongCount > 0 && (
                      <span className="chip chip--warning">错过 {item.wrongCount} 次</span>
                    )}
                    <button
                      type="button"
                      className="button button--small button--danger"
                      onClick={() => void remove(item.entryId)}
                    >
                      移除
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
