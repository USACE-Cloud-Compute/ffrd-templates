# FFRD Standard Directory and Templates

This site provides:

1. The standard directory structure for FFRD projects
    - description of intent for each folder and subfolder
    - downloadable template directory

2.  FFRD SOP templates and useful tools
     - QC Checklists, Documentation Checklists, etc
     - Useful tools

Site: https://usace-cloud-compute.github.io/ffrd-templates/

## How it works

- `docs/basin-name/` is the template. Each folder holds an `index.md` describing its
  intended use. These files are data, not site pages (`exclude_docs` in `mkdocs.yml`):
  the site is a single home page with a folder browser. Every folder has an `index.md`, so
  no placeholder files are needed to keep folders in git.
- `hooks/ffrd_site.py` runs on every build and generates, without touching `docs/`:
  - `assets/tree.json`, which feeds the interactive folder browser on the home page
    (`docs/javascripts/ffrd-tree.js`);
  - `assets/ffrd-directory-structure.zip`, the empty template. `index.md` becomes `README.md` in
    every folder. Empty folders survive the download because the zip
    lists every folder explicitly and each one contains a `README.md`.
  - `assets/templates-tree.json` and `assets/ffrd-templates.zip`, from `docs/ffrd-templates/`
    (see below).
- `docs/ffrd-templates/` is a separate folder of downloadable templates, unrelated to the
  `basin-name` structure. Add folders and files there as they should appear in the download;
  the Templates section of the home page lists them by name, and the zip contains them
  as-is. Files and folders starting with `.` are left out, so a `.gitkeep` can hold an
  otherwise empty folder in git.
- Settings (template folders, zip names, README name) are under `extra.ffrd` in `mkdocs.yml`.

## Editing

1. Create a fork of the repository
2. Write or edit the folder's `index.md` on a separate branch. A folder with no description yet holds the
   placeholder text set in `mkdocs.yml` (`extra.ffrd.placeholder`); `fix_titles.py` adds it
   to any new or heading-only page (not the template root). Text before the first `##` heading is what the
   browser shows as the summary. A section on a parent page whose heading names a child
   folder (for example `## HOT-FIX`) is used for that child if its own page is empty.
3. Preview: run `serve.bat`, or `pip install -r requirements.txt` then `mkdocs serve`.
4. Create a pull request to the usace-cloud-compute/ffrd-templates main.
5. A repo owner will review and approve and merge into `main`; the workflow deploys.

Add `?audit` to the home page URL to list folders that still have only the placeholder.
