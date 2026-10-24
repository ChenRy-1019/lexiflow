import { useCallback, useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";

import {
  importBook,
  previewImport,
  type ImportPreview,
  type ParsedRow,
} from "../lib/api";

interface ImportDialogProps {
  onClose: () => void;
  /** Called after a successful import so the library refreshes. */
  onImported: (name: string) => void;
  notify: (message: string) => void;
}

/** The file types the backend can read. */
const FILTER = {
  name: "词书文件",
  extensions: ["txt", "csv", "tsv", "md", "xlsx", "xls", "ods", "pdf"],
};

/** The stages of the import, in order. */
type Stage = "pick" | "preview" | "saving";

/**
 * Import a wordbook from a file.
 *
 * The flow is deliberate: choose a file, see exactly what was extracted, fix
 * the columns if they were read wrongly, then import. A PDF extraction in
 * particular needs checking, and showing the rows first makes a bad read
 * obvious before it reaches the learner's book.
 */
export default function ImportDialog({ onClose, onImported, notify }: ImportDialogProps) {
  const [stage, setStage] = useState<Stage>("pick");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [name, setName] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [error, setError] = useState<string | null>(null);

  /** Open the file picker and read the chosen file. */
  const chooseFile = useCallback(async () => {
    setError(null);
    try {
      const picked = await open({ multiple: false, filters: [FILTER] });
      if (typeof picked !== "string") return;

      const result = await previewImport(picked);
      setPreview(result);
      setRows(result.rows);
      setName(result.suggestedName);
      setSourcePath(picked);
      setStage("preview");
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    }
  }, []);

  /** Re-read the rows with different columns. */
  const useColumn = useCallback(
    async (wordColumn: number, meaningColumn: number | null) => {
      if (!sourcePath) return;
      setError(null);
      try {
        // Re-reading keeps the words and glosses in step with the columns the
        // learner picked, rather than patching the existing rows.
        const again = await previewImportWithColumns(sourcePath, wordColumn, meaningColumn);
        setRows(again);
      } catch (thrown) {
        setError(thrown instanceof Error ? thrown.message : String(thrown));
      }
    },
    [sourcePath],
  );

  /** Write the rows as a new book. */
  const confirm = useCallback(async () => {
    if (!preview || rows.length === 0) return;
    setStage("saving");
    setError(null);
    try {
      const book = await importBook(name.trim() || "我的词书", sourcePath, preview.format, rows);
      notify(`已导入「${book.name}」，共 ${book.total} 词`);
      onImported(book.name);
      onClose();
    } catch (thrown) {
      setStage("preview");
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    }
  }, [preview, rows, name, sourcePath, notify, onImported, onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal import-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="导入词书"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="import-dialog__head">
          <h2 className="import-dialog__title">导入词书</h2>
          <p className="import-dialog__subtitle">
            支持 {".txt .csv .tsv .md .xlsx .xls .ods .pdf"}
          </p>
        </header>

        <div className="import-dialog__body">
          {stage === "pick" && (
            <div className="import-dialog__pick">
              <button type="button" className="button button--primary" onClick={() => void chooseFile()}>
                选择文件
              </button>
              <p className="import-dialog__hint">
                表格里只要有「单词」和「释义」两列就能导入，列的顺序不限，会自动识别。
              </p>
            </div>
          )}

          {preview && stage !== "pick" && (
            <>
              <div className="import-dialog__summary">
                <span className="chip chip--outline">{preview.format}</span>
                <span className="chip chip--outline">{rows.length} 词</span>
                {preview.skipped > 0 && (
                  <span className="chip chip--outline">跳过 {preview.skipped} 行</span>
                )}
                {preview.warning && (
                  <p className="import-dialog__warning">{preview.warning}</p>
                )}
              </div>

              <label className="field" style={{ marginBottom: 14 }}>
                <span className="field__label">词书名称</span>
                <input
                  className="input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="我的词书"
                />
              </label>

              {preview.headers.length > 1 && (
                <div className="import-dialog__columns">
                  <span className="field__label">列对应</span>
                  <div className="import-dialog__column-row">
                    <label className="import-dialog__column">
                      <span>单词列</span>
                      <select
                        className="input"
                        value={preview.wordColumn}
                        onChange={(event) =>
                          void useColumn(Number(event.target.value), preview.meaningColumn)
                        }
                      >
                        {preview.headers.map((header, index) => (
                          <option key={index} value={index}>
                            {header || `第 ${index + 1} 列`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="import-dialog__column">
                      <span>释义列</span>
                      <select
                        className="input"
                        value={preview.meaningColumn ?? -1}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          void useColumn(preview.wordColumn, value < 0 ? null : value);
                        }}
                      >
                        <option value={-1}>（没有释义）</option>
                        {preview.headers.map((header, index) => (
                          <option key={index} value={index}>
                            {header || `第 ${index + 1} 列`}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              )}

              <div className="import-dialog__rows">
                <table className="import-table">
                  <thead>
                    <tr>
                      <th>单词</th>
                      <th>释义</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 50).map((row, index) => (
                      <tr key={index}>
                        <td className="import-table__word">{row.word}</td>
                        <td>{row.meaning || <span className="import-table__empty">无</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 50 && (
                  <p className="import-dialog__more">下面还有 {rows.length - 50} 条</p>
                )}
                {rows.length === 0 && (
                  <p className="import-dialog__warning">
                    没有识别出词条。检查一下文件里是不是每行一个「单词 释义」。
                  </p>
                )}
              </div>
            </>
          )}

          {error && <p className="import-dialog__error">{error}</p>}
        </div>

        <footer className="import-dialog__foot">
          <button type="button" className="button" onClick={onClose}>
            取消
          </button>
          {stage === "pick" ? (
            <button type="button" className="button button--primary" onClick={() => void chooseFile()}>
              选择文件
            </button>
          ) : (
            <button
              type="button"
              className="button button--primary"
              onClick={() => void confirm()}
              disabled={rows.length === 0 || !name.trim()}
            >
              {stage === "saving" ? "导入中…" : `导入 ${rows.length} 词`}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

/** Re-read a file with an explicit column mapping.
 *
 * The preview command accepts the columns, so changing them is the same call
 * with different arguments: the file is parsed again on the backend and the
 * rows come back already paired. Re-reading avoids having to send the raw
 * grid to the frontend and keep two representations in step.
 */
async function previewImportWithColumns(
  path: string,
  wordColumn: number,
  meaningColumn: number | null,
): Promise<ParsedRow[]> {
  const result = await previewImport(path, wordColumn, meaningColumn);
  return result.rows;
}
