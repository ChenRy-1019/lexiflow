"""Add styles for the update dialog and the settings update row."""

from pathlib import Path

path = Path("src/styles/global.css")
css = path.read_text(encoding="utf-8")

anchor = """/* --------------------------------------------------------------- practice */"""

addition = """/* ---------------------------------------------------------- update dialog */

.update-dialog {
  max-width: 560px;
}

.update-dialog__head {
  padding: 22px 26px 14px;
  border-bottom: 1px solid var(--border);
}

.update-dialog__title {
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 6px;
  letter-spacing: -0.01em;
}

.update-dialog__versions {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.update-dialog__body {
  padding: 18px 26px;
  max-height: 340px;
  overflow-y: auto;
}

.update-dialog__note {
  padding: 18px 26px;
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
}

.update-dialog__section {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 10px;
}

.update-dialog__notes {
  margin: 0;
  padding: 12px 16px 12px 32px;
  background: var(--surface-alt);
  border-radius: var(--radius);
  font-size: 13px;
  line-height: 1.75;
  color: var(--text-secondary);
}

.update-dialog__notes li {
  margin-bottom: 4px;
}

.update-dialog__notes li:last-child {
  margin-bottom: 0;
}

.update-dialog__empty {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.7;
}

.update-dialog__error {
  font-size: 12px;
  color: var(--red);
  margin: 10px 0 0;
  word-break: break-word;
}

.update-dialog__progress {
  margin-top: 16px;
}

.update-dialog__progress-text {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 8px;
  font-variant-numeric: tabular-nums;
}

.update-dialog__foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 26px;
  border-top: 1px solid var(--border);
}

.update-dialog__foot a.button {
  text-decoration: none;
}

/* ------------------------------------------------------ settings: update */

.update-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 14px 16px;
  background: var(--surface-alt);
  border-radius: var(--radius);
}

.update-row__info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.update-row__version {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.update-row__toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
}

.update-row__toggle input {
  width: 15px;
  height: 15px;
  accent-color: var(--blue);
  cursor: pointer;
}

/* --------------------------------------------------------------- practice */"""

if anchor in css:
    css = css.replace(anchor, addition, 1)
    print("styles added")
else:
    print("ANCHOR NOT FOUND")

path.write_text(css, encoding="utf-8")
