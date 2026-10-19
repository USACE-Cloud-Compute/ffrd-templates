import os
import re

import yaml

# Only the template folder mirrors a real directory structure (see set_titles.py).
ROOT = os.path.join("docs", "basin-name")
SKIP_DIRS = {"stylesheets", "javascripts"}

# Single source of truth is mkdocs.yml (extra.ffrd.placeholder); the site treats a page
# that holds only this text as "no description of its own".
with open("mkdocs.yml", encoding="utf-8") as f:
    PLACEHOLDER = yaml.safe_load(f)["extra"]["ffrd"]["placeholder"]

for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]

    folder_name = os.path.basename(dirpath)
    index_path = os.path.join(dirpath, "index.md")
    is_root = os.path.abspath(dirpath) == os.path.abspath(ROOT)   # nothing above it to point to
    stub = f"# {folder_name}\n"
    filler = "" if is_root else f"\n{PLACEHOLDER}\n"

    # Create index.md if missing
    if "index.md" not in filenames:
        with open(index_path, "w", encoding="utf-8") as f:
            f.write(stub + filler)
        print(f"Created: {index_path}")
        continue

    with open(index_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Fix title in existing index.md
    if re.match(r'^# ', content, re.MULTILINE):
        new_content = re.sub(r'^# .+', f'# {folder_name}', content, count=1, flags=re.MULTILINE)
    else:
        new_content = f"# {folder_name}\n\n" + content

    # A page that is only a heading gets the placeholder text
    if new_content.strip() == stub.strip():
        new_content = stub + filler

    if new_content != content:
        with open(index_path, "w", encoding="utf-8") as f:
            f.write(new_content)
        print(f"Updated: {index_path}")
    else:
        print(f"OK: {index_path}")
