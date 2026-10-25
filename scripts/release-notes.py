"""Prints the CHANGELOG.md section for one version (release notes and the in-app update window)."""
import re, sys, os
version = sys.argv[1]
text = open(os.path.join(os.path.dirname(__file__), "..", "CHANGELOG.md"), encoding="utf-8").read()
m = re.search(r"^## \[?v?" + re.escape(version) + r"\]?[^\n]*\n(.*?)(?=^## |\Z)", text, re.S | re.M)
print((m.group(1).strip() if m else f"Monolith {version}"))
