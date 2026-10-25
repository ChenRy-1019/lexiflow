"""Publish the installer to Gitee.

Gitee's API differs from GitHub's: a release is created for an existing tag, and
assets are attached in a second call with a multipart upload. The token is read
from the GITEE_TOKEN environment variable so it never appears in a file.

Usage:
    python scripts/publish-gitee.py [--tag v0.2.6]
"""

from __future__ import annotations

import json
import mimetypes
import os
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OWNER = "chens-code-rythm"
REPO = "lexiflow"
API = "https://gitee.com/api/v5"
TOKEN = os.environ.get("GITEE_TOKEN", "")

SETUP_DIR = ROOT / "src-tauri" / "target" / "release" / "bundle" / "nsis"


def call(method: str, url: str, body: dict | None = None) -> dict | None:
    """JSON request against the Gitee API, returning None on 404.

    A missing release is an expected answer rather than a failure, so a 404 is
    reported as None and the caller decides whether to create one.
    """
    data = None
    headers = {"User-Agent": "LexiFlow", "Content-Type": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        detail = error.read().decode("utf-8", "replace")[:300]
        raise SystemExit(f"{method} {url} failed: {error.code} {detail}") from error


def upload_asset(release_id: int, path: Path) -> dict:
    """Attach a file to a release using a multipart body."""
    boundary = "----LexiFlow" + uuid.uuid4().hex
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"

    parts: list[bytes] = []
    parts.append(f"--{boundary}\r\n".encode())
    parts.append(
        f'Content-Disposition: form-data; name="file"; filename="{path.name}"\r\n'.encode()
    )
    parts.append(f"Content-Type: {mime}\r\n\r\n".encode())
    parts.append(path.read_bytes())
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    body = b"".join(parts)

    url = f"{API}/repos/{OWNER}/{REPO}/releases/{release_id}/attach_files?access_token={TOKEN}"
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "User-Agent": "LexiFlow",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(body)),
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> None:
    if not TOKEN:
        raise SystemExit("GITEE_TOKEN is not set")

    tag = "v0.2.6"
    for index, arg in enumerate(sys.argv):
        if arg == "--tag" and index + 1 < len(sys.argv):
            tag = sys.argv[index + 1]

    setup = SETUP_DIR / f"LexiFlow_{tag.lstrip('v')}_x64-setup.exe"
    sig = Path(str(setup) + ".sig")
    for path in (setup, sig):
        if not path.exists():
            raise SystemExit(f"missing {path}")

    body_text = (ROOT / "release-notes.md").read_text(encoding="utf-8")

    # An existing release is reused rather than duplicated.
    existing = call(
        "GET", f"{API}/repos/{OWNER}/{REPO}/releases/tags/{tag}?access_token={TOKEN}"
    )
    release_id = existing["id"] if existing else None
    print(f"existing release: {release_id}")

    if not release_id:
        created = call(
            "POST",
            f"{API}/repos/{OWNER}/{REPO}/releases?access_token={TOKEN}",
            {"tag_name": tag, "name": f"LexiFlow {tag.lstrip('v')}", "body": body_text, "target_commitish": "master"},
        )
        if not created:
            raise SystemExit("could not create the release")
        release_id = created["id"]
        existing = created
        print(f"created release: {release_id}")

    attached = {asset["name"] for asset in (existing.get("assets") if existing else []) or []}

    for path in (setup, sig):
        if path.name in attached:
            print(f"already attached: {path.name}")
            continue
        result = upload_asset(release_id, path)
        print(f"uploaded {path.name}: {result.get('browser_download_url', '')}")

    print("done")


if __name__ == "__main__":
    main()
