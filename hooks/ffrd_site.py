"""Build-time generators for the FFRD directory site.

Reads the folder tree under ``docs/<template_root>`` and produces two files that
are added to the built site (nothing is written into the source tree):

* ``assets/tree.json``   - drives the interactive folder browser on the home page
* ``assets/<zip_name>``  - the empty template directory, description files included

and does the same, names only, for each separate download folder (Templates, Resources):

* ``assets/<key>-tree.json`` - drives that section's folder and file tree
  (``templates-tree.json`` from ``docs/<templates_root>``, ``resources-tree.json`` from
  ``docs/<resources_root>``)
* ``assets/<key>_zip``       - that folder as-is (hidden files such as .gitkeep left out)

The build functions are plain Python with no MkDocs dependency, so they
can also be run on their own: ``python hooks/ffrd_site.py --out build-assets``.
Configuration lives under ``extra.ffrd`` in mkdocs.yml.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import zipfile
from pathlib import Path

import markdown

DEFAULTS = {
    "template_root": "basin-name",  # folder under docs/ that is the template
    "desc_file": "index.md",        # description file inside every folder
    "zip_name": "ffrd-directory-structure.zip",
    "zip_desc_file": "README.md",   # what desc_file is renamed to inside the zip
    "zip_exclude": [".pages"],      # MkDocs plumbing, not part of the template
    "placeholder": "ffrd directory structure. see parent directory for description of intended use",
    "templates_root": "ffrd-templates",  # folder under docs/ holding the downloadable templates
    "templates_zip": "ffrd-templates.zip",
    "resources_root": "resources",       # folder under docs/ holding reference material
    "resources_zip": "ffrd-resources.zip",
}
FILE_SECTIONS = ("templates", "resources")  # each reads <key>_root and <key>_zip from the config
_MD_EXT = ["tables", "sane_lists", "admonition"]


# --------------------------------------------------------------------------- #
# Markdown helpers
# --------------------------------------------------------------------------- #
def _norm(text: str) -> str:
    """Lowercase; hyphens/underscores become spaces; punctuation dropped."""
    text = re.sub(r"[-_]+", " ", text.lower())
    return " ".join(re.sub(r"[^a-z0-9 ]+", " ", text).split())


def _mentions(heading: str, name: str) -> bool:
    return re.search(rf"\b{re.escape(_norm(name))}\b", _norm(heading)) is not None


def _split_sections(md: str):
    """Return (preamble, sections). A section is (level, heading, body) and its
    body includes any deeper sub-sections, so each section is a complete block.
    The page title (first line, if it is an H1) is dropped; any later heading of any
    level starts a section, because some pages use H1s for their sections."""
    md = re.sub(r"\A---\n.*?\n---\n", "", md, flags=re.S)  # front matter
    lines = md.lstrip().splitlines()
    if lines and re.match(r"#\s", lines[0]):
        lines = lines[1:]                                   # drop the page title
    preamble, flat, cur = [], [], None
    for line in lines:
        m = re.match(r"(#{1,6})\s+(.*?)\s*#*\s*$", line)
        if m:
            cur = (len(m.group(1)), m.group(2), [])
            flat.append(cur)
        elif cur is None:
            preamble.append(line)
        else:
            cur[2].append(line)
    sections = []
    for i, (lv, h, body) in enumerate(flat):
        parts = list(body)
        for lv2, h2, body2 in flat[i + 1:]:
            if lv2 <= lv:
                break
            parts += ["", "#" * lv2 + " " + h2, *body2]
        sections.append((lv, h, "\n".join(parts).strip()))
    return "\n".join(preamble).strip(), sections


def _own_markdown(preamble: str, sections: list, child_names: list[str]) -> str:
    """The folder's own description: text before the first H2 plus every top-level
    section that is not just about one of its child folders."""
    if not sections:
        return preamble
    top = min(lv for lv, _, _ in sections)
    parts = [preamble] if preamble else []
    for lv, h, body in sections:
        if lv == top and not any(_mentions(h, c) for c in child_names):
            parts.append(f"#### {h}\n\n{body}" if body else "")
    return "\n\n".join(p for p in parts if p)


def _to_html(md: str) -> str:
    return markdown.markdown(md, extensions=_MD_EXT) if md.strip() else ""


# --------------------------------------------------------------------------- #
# Tree
# --------------------------------------------------------------------------- #
def _node(folder: Path, root: Path, cfg: dict, parent_sections: list) -> dict:
    rel = folder.relative_to(root)
    desc = folder / cfg["desc_file"]
    raw = desc.read_text(encoding="utf-8") if desc.exists() else ""
    preamble, sections = _split_sections(raw)
    subdirs = sorted((p for p in folder.iterdir() if p.is_dir()), key=lambda p: p.name.lower())

    own_md = _own_markdown(preamble, sections, [p.name for p in subdirs])
    is_placeholder = _norm(own_md) == _norm(cfg["placeholder"])
    if is_placeholder or not own_md.strip():
        own_md = ""
    # own = real text of its own; placeholder = only the standard placeholder text;
    # missing = nothing at all. inherited = no text of its own, but described by a
    # section on the parent's page.
    status = "own" if own_md else ("placeholder" if is_placeholder else "missing")
    if not own_md and parent_sections:
        hit = next((b for _, h, b in parent_sections if _mentions(h, folder.name) and b), "")
        if hit:
            own_md, status = hit, "inherited"

    return {
        "name": folder.name,
        "path": "/".join(rel.parts),
        "status": status,
        "html": _to_html(own_md),
        "files": sorted(
            p.name for p in folder.iterdir()
            if p.is_file() and p.name not in cfg["zip_exclude"] and p.name != cfg["desc_file"]
        ),
        "children": [_node(p, root, cfg, sections) for p in subdirs],
    }


def build_tree(docs_dir: Path, cfg: dict) -> dict:
    cfg = {**DEFAULTS, **cfg}
    root = Path(docs_dir) / cfg["template_root"]
    tree = _node(root, root, cfg, [])
    counts = {"own": 0, "inherited": 0, "placeholder": 0, "missing": 0}

    def walk(n):
        counts[n["status"]] += 1
        for c in n["children"]:
            walk(c)

    walk(tree)
    return {"root": tree, "counts": counts, "zip": cfg["zip_name"]}


# --------------------------------------------------------------------------- #
# Zip
# --------------------------------------------------------------------------- #
_EPOCH = (2020, 1, 1, 0, 0, 0)  # fixed timestamp -> identical zip on every build


def _dir_entry(name: str) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name.rstrip("/") + "/", _EPOCH)
    info.external_attr = (0o40755 << 16) | 0x10
    return info


def build_zip(docs_dir: Path, cfg: dict) -> bytes:
    cfg = {**DEFAULTS, **cfg}
    top = cfg["template_root"]
    root = Path(docs_dir) / top
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(_dir_entry(top), b"")
        for path in sorted(root.rglob("*")):
            arc = "/".join((top, *path.relative_to(root).parts))
            if path.is_dir():
                zf.writestr(_dir_entry(arc), b"")   # keeps folders that hold no files
            elif path.name not in cfg["zip_exclude"]:
                if path.name == cfg["desc_file"]:
                    arc = arc[: -len(path.name)] + cfg["zip_desc_file"]
                info = zipfile.ZipInfo(arc, _EPOCH)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                zf.writestr(info, path.read_bytes())
    return buf.getvalue()


# --------------------------------------------------------------------------- #
# Download folders (Templates, Resources): names only, copied as-is
# --------------------------------------------------------------------------- #
def _hidden(rel: Path) -> bool:
    """Dotfiles (.gitkeep keeps an otherwise empty folder in git) are not templates."""
    return any(part.startswith(".") for part in rel.parts)


def _plain_node(folder: Path, root: Path) -> dict:
    items = sorted((p for p in folder.iterdir() if not _hidden(p.relative_to(root))),
                   key=lambda p: p.name.lower())
    return {
        "name": folder.name,
        "path": "/".join(folder.relative_to(root).parts),
        "files": [p.name for p in items if p.is_file()],
        "children": [_plain_node(p, root) for p in items if p.is_dir()],
    }


def build_files_tree(docs_dir: Path, cfg: dict, key: str) -> dict:
    cfg = {**DEFAULTS, **cfg}
    top = cfg[f"{key}_root"]
    root = Path(docs_dir) / top
    node = (_plain_node(root, root) if root.is_dir()
            else {"name": top, "path": "", "files": [], "children": []})
    return {"root": node, "zip": cfg[f"{key}_zip"]}


def build_files_zip(docs_dir: Path, cfg: dict, key: str) -> bytes:
    cfg = {**DEFAULTS, **cfg}
    top = cfg[f"{key}_root"]
    root = Path(docs_dir) / top
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(_dir_entry(top), b"")
        for path in sorted(root.rglob("*")) if root.is_dir() else []:
            rel = path.relative_to(root)
            if _hidden(rel):
                continue
            arc = "/".join((top, *rel.parts))
            if path.is_dir():
                zf.writestr(_dir_entry(arc), b"")
            else:
                info = zipfile.ZipInfo(arc, _EPOCH)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                zf.writestr(info, path.read_bytes())
    return buf.getvalue()


# --------------------------------------------------------------------------- #
# MkDocs glue
# --------------------------------------------------------------------------- #
def on_config(config):
    """Add a content hash to the site's own CSS and JS links (ffrd-tree.css?v=1a2b3c4d).
    GitHub Pages lets browsers cache them for 10 minutes under a fixed address, so
    without this a visitor can get new HTML with an old stylesheet after a deploy."""
    docs_dir = Path(config["docs_dir"])

    def stamp(path: str) -> str:
        src = docs_dir / path
        if "?" in path or not src.is_file():
            return path
        return f"{path}?v={hashlib.sha1(src.read_bytes()).hexdigest()[:8]}"

    config["extra_css"] = [stamp(p) for p in config["extra_css"]]
    scripts = config["extra_javascript"]
    for i, script in enumerate(scripts):   # plain strings, or objects when given options
        if isinstance(script, str):
            scripts[i] = stamp(script)
        else:
            script.path = stamp(script.path)
    return config


def on_files(files, config):
    from mkdocs.structure.files import File

    cfg = {**DEFAULTS, **(config.get("extra", {}).get("ffrd") or {})}
    docs_dir = Path(config["docs_dir"])
    tree = build_tree(docs_dir, cfg)
    c = tree["counts"]
    print(
        f"INFO    -  ffrd_site: {sum(c.values())} folders "
        f"({c['own']} described, {c['inherited']} via parent page, "
        f"{c['placeholder']} placeholder only, {c['missing']} empty)"
    )
    payload = [
        ("assets/tree.json", json.dumps(tree, ensure_ascii=False, separators=(",", ":"))),
        (f"assets/{cfg['zip_name']}", build_zip(docs_dir, cfg)),
    ]
    for key in FILE_SECTIONS:
        print(f"INFO    -  ffrd_site: {key} folder '{cfg[key + '_root']}' -> {cfg[key + '_zip']}")
        payload += [
            (f"assets/{key}-tree.json",
             json.dumps(build_files_tree(docs_dir, cfg, key), ensure_ascii=False, separators=(",", ":"))),
            (f"assets/{cfg[key + '_zip']}", build_files_zip(docs_dir, cfg, key)),
        ]
    for src_uri, content in payload:
        files.append(File.generated(config, src_uri, content=content))
    return files


if __name__ == "__main__":  # standalone use, no MkDocs needed
    ap = argparse.ArgumentParser(description="Write the tree JSON files and the zips.")
    ap.add_argument("--docs", default="docs")
    ap.add_argument("--out", default="build-assets")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "tree.json").write_text(json.dumps(build_tree(Path(a.docs), {})), encoding="utf-8")
    (out / DEFAULTS["zip_name"]).write_bytes(build_zip(Path(a.docs), {}))
    for key in FILE_SECTIONS:
        (out / f"{key}-tree.json").write_text(json.dumps(build_files_tree(Path(a.docs), {}, key)), encoding="utf-8")
        (out / DEFAULTS[f"{key}_zip"]).write_bytes(build_files_zip(Path(a.docs), {}, key))
    print(f"wrote {out}/")
