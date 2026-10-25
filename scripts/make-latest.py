"""Writes latest.json, which installed copies of Monolith read to find updates.
   make-latest.py <version> <repo> [--win <Setup.exe>] [--mac <mac.zip>]
latest.json is then signed (latest.json.sig) with the Monolith signing key; the app ignores it otherwise."""
import hashlib, json, os, sys, datetime, subprocess
def asset(path, version, repo):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""): h.update(chunk)
    name = os.path.basename(path)
    return {"file": name, "url": f"https://github.com/{repo}/releases/download/v{version}/{name}", "sha256": h.hexdigest(), "size": os.path.getsize(path)}
version, repo = sys.argv[1], sys.argv[2]
opts = dict(zip(sys.argv[3::2], sys.argv[4::2]))
notes = subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "release-notes.py"), version], capture_output=True, text=True).stdout.strip()
platforms = {}
if opts.get("--win"): platforms["win32"] = asset(opts["--win"], version, repo)
if opts.get("--mac"): platforms["darwin"] = asset(opts["--mac"], version, repo)
print(json.dumps({"format": "monolith-update", "version": version, "date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "notes": notes, "platforms": platforms}, indent=1))
