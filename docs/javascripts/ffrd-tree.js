/* Interactive folder browser for the FFRD directory template.
 * Reads assets/tree.json (generated at build time by hooks/ffrd_site.py) and renders
 * a collapsible tree plus a description panel into <div id="ffrd-tree">.
 * Deep links: #f=basin-data/dams selects that folder. Add ?audit to the URL to flag
 * folders that still have no description.
 * Also renders a names-only folder and file tree into every <div data-ffrd-files>
 * (Templates: assets/templates-tree.json, Resources: assets/resources-tree.json).
 * data-empty sets the text shown when that folder is empty.
 * Links marked <a href="image" data-ffrd-popup data-title="..."> open the image in a
 * dialog instead of a new page; without JavaScript they still open the image. */
(function () {
  "use strict";

  var FLAGS = { missing: "empty", placeholder: "placeholder only", inherited: "described on parent page" };
  function undescribed(n) { return n.status === "missing" || n.status === "placeholder"; }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function init() {
    var host = document.getElementById("ffrd-tree");
    if (!host || host.dataset.ready) return;
    host.dataset.ready = "1";
    host.classList.add("ffrd");
    var base = typeof __md_scope !== "undefined" ? __md_scope : location.href;
    var audit = /[?&]audit\b/.test(location.search);

    fetch(new URL(host.dataset.src || "assets/tree.json", base))
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) { render(host, data, base, audit); })
      .catch(function () {
        host.textContent = "The folder browser could not be loaded. Use the navigation on the left instead.";
      });
  }

  function render(host, data, base, audit) {
    var byPath = new Map();   // path -> {node, li, kids, row, text}
    var total = 0;

    /* ---- controls ---- */
    var bar = el("div", "ffrd__bar");
    var search = el("input", "ffrd__search");
    search.type = "search";
    search.placeholder = "Filter folders, e.g. hydraulics or levee";
    search.setAttribute("aria-label", "Filter folders");
    var expand = el("button", "ffrd__btn", "Expand all");
    var collapse = el("button", "ffrd__btn", "Collapse all");
    expand.type = collapse.type = "button";
    var auditLabel = el("label", "ffrd__audit");
    var auditBox = el("input");
    auditBox.type = "checkbox";
    auditLabel.append(auditBox, " Only folders without a description of their own");
    auditLabel.hidden = !audit;
    var count = el("span", "ffrd__count");
    count.setAttribute("aria-live", "polite");
    bar.append(search, expand, collapse, auditLabel, count);

    var tree = el("ul", "ffrd__tree");
    var panel = el("aside", "ffrd__panel");
    panel.setAttribute("aria-live", "polite");
    var body = el("div", "ffrd__body");
    body.append(tree, panel);
    host.replaceChildren(bar, body);

    /* ---- tree ---- */
    function plain(html) {
      var d = document.createElement("div");
      d.innerHTML = html;
      return d.textContent.toLowerCase();
    }

    function setOpen(entry, open) {
      if (!entry.kids) return;
      entry.kids.hidden = !open;
      entry.row.setAttribute("aria-expanded", open ? "true" : "false");
    }

    function build(node, depth) {
      total++;
      var li = el("li", "ffrd__item");
      var row, kids = null;

      function fill(target) {
        target.append(el("span", "ffrd-icon ffrd-icon--folder"), el("span", "ffrd__name", node.name));
        if (audit && node.status !== "own") {
          target.append(el("span", "ffrd__flag", FLAGS[node.status]));
        }
      }

      if (node.children.length) {
        row = el("button", "ffrd__row is-folder");
        row.type = "button";
        row.setAttribute("aria-expanded", depth === 0 ? "true" : "false");
        fill(row);
        kids = el("ul", "ffrd__kids");
        kids.hidden = depth !== 0;
        node.children.forEach(function (c) { kids.append(build(c, depth + 1)); });
        li.append(row, kids);
      } else {
        row = el("button", "ffrd__row ffrd__leaf");
        row.type = "button";
        fill(row);
        li.append(row);
      }
      row.dataset.path = node.path;
      row.addEventListener("click", function () {
        if (kids) setOpen(byPath.get(node.path), kids.hidden);
        select(node.path, false);
      });
      byPath.set(node.path, {
        node: node, li: li, kids: kids, row: row,
        text: (node.name + " " + node.path + " " + plain(node.html)).toLowerCase()
      });
      return li;
    }
    tree.append(build(data.root, 0));
    count.textContent = total + " folders";

    /* ---- selection + panel ---- */
    var current = null;

    function crumbs(path) {
      var wrap = el("nav", "ffrd__path");
      wrap.setAttribute("aria-label", "Folder path");
      var parts = path ? path.split("/") : [];
      var names = [data.root.name].concat(parts);
      names.forEach(function (part, i) {
        if (i) wrap.append(el("span", "ffrd__sep", "/"));
        if (i === names.length - 1) { wrap.append(el("strong", "ffrd__crumb", part)); return; }
        var b = el("button", "ffrd__link", part);
        b.type = "button";
        var target = parts.slice(0, i).join("/");   // i = 0 is the template root
        b.addEventListener("click", function () { select(target, true); });
        wrap.append(b);
      });
      return wrap;
    }

    function showPanel(entry) {
      var n = entry.node;
      var desc = el("div", "ffrd__desc");
      if (undescribed(n)) {
        desc.append(el("p", "ffrd__empty", "This folder does not have a description yet. See the parent folder for its intended use."));
        if (n.path) {
          var up = el("button", "ffrd__btn", "Show parent folder");
          up.type = "button";
          up.addEventListener("click", function () { select(n.path.split("/").slice(0, -1).join("/"), true); });
          desc.append(up);
        }
      } else {
        desc.innerHTML = n.html;
        if (n.status === "inherited") {
          desc.append(el("p", "ffrd__note", "Described on the parent folder\u2019s page."));
        }
      }
      var parts = [crumbs(n.path), desc];
      if (n.files.length) {
        var f = el("p", "ffrd__files");
        f.append("Files in the template: ");
        n.files.forEach(function (name, i) {
          if (i) f.append(", ");
          f.append(el("code", null, name));
        });
        parts.push(f);
      }
      var actions = el("p", "ffrd__actions");
      var copy = el("button", "ffrd__btn", "Copy path");
      copy.type = "button";
      copy.addEventListener("click", function () {
        var text = [data.root.name].concat(n.path ? [n.path] : []).join("/");
        var done = function () { copy.textContent = "Copied"; setTimeout(function () { copy.textContent = "Copy path"; }, 1500); };
        if (navigator.clipboard) navigator.clipboard.writeText(text).then(done);
      });
      actions.append(copy);
      parts.push(actions);
      panel.replaceChildren.apply(panel, parts);
    }

    function select(path, reveal) {
      var entry = byPath.get(path);
      if (!entry) return;
      if (current) { current.row.classList.remove("is-selected"); current.row.removeAttribute("aria-current"); }
      current = entry;
      entry.row.classList.add("is-selected");
      entry.row.setAttribute("aria-current", "true");
      if (reveal) {
        for (var p = entry.li.parentElement; p && p !== tree; p = p.parentElement) {
          p.hidden = false;
          if (p.classList.contains("ffrd__kids")) p.previousElementSibling.setAttribute("aria-expanded", "true");
        }
        entry.row.scrollIntoView({ block: "nearest" });
      }
      showPanel(entry);
      history.replaceState(null, "", location.pathname + location.search + (path ? "#f=" + path : ""));
    }

    /* ---- filter ---- */
    function apply() {
      var q = search.value.trim().toLowerCase();
      var onlyMissing = auditBox.checked;
      var shown = 0;
      function walk(path) {
        var e = byPath.get(path);
        var hit = (!q || e.text.indexOf(q) !== -1) && (!onlyMissing || undescribed(e.node));
        var anyChild = false;
        e.node.children.forEach(function (c) { if (walk(c.path)) anyChild = true; });
        var visible = hit || anyChild;
        e.li.hidden = !visible;
        e.row.classList.toggle("is-hit", !!q && hit);
        if (hit && visible) shown++;
        if (e.kids && (q || onlyMissing)) setOpen(e, anyChild);
        return visible;
      }
      walk("");
      if (!q && !onlyMissing) {
        byPath.forEach(function (e) { setOpen(e, e.node.path === ""); });
        count.textContent = total + " folders";
      } else {
        count.textContent = shown + " of " + total + " folders";
      }
    }
    search.addEventListener("input", apply);
    auditBox.addEventListener("change", apply);
    expand.addEventListener("click", function () { byPath.forEach(function (e) { setOpen(e, true); }); });
    collapse.addEventListener("click", function () { byPath.forEach(function (e) { setOpen(e, e.node.path === ""); }); });

    /* ---- keyboard: arrows move through the visible rows ---- */
    function isShown(row) {
      for (var p = row.parentElement; p && p !== tree; p = p.parentElement) if (p.hidden) return false;
      return true;
    }
    tree.addEventListener("keydown", function (ev) {
      var row = ev.target.closest(".ffrd__row");
      if (!row) return;
      var rows = Array.prototype.filter.call(tree.querySelectorAll(".ffrd__row"), isShown);
      var i = rows.indexOf(row);
      var entry = byPath.get(row.dataset.path);
      var isOpen = !!entry.kids && !entry.kids.hidden;
      var next = null;
      if (ev.key === "ArrowDown") next = rows[i + 1];
      else if (ev.key === "ArrowUp") next = rows[i - 1];
      else if (ev.key === "Home") next = rows[0];
      else if (ev.key === "End") next = rows[rows.length - 1];
      else if (ev.key === "ArrowRight" && entry.kids) { if (!isOpen) setOpen(entry, true); else next = rows[i + 1]; }
      else if (ev.key === "ArrowLeft") {
        if (isOpen) setOpen(entry, false);
        else { var up = row.closest("ul.ffrd__kids"); next = up && up.previousElementSibling; }
      } else return;
      ev.preventDefault();
      if (next) next.focus();
    });

    /* ---- initial state ---- */
    var m = /^#f=(.*)$/.exec(location.hash);
    if (m && byPath.has(decodeURIComponent(m[1]))) select(decodeURIComponent(m[1]), true);
    else panel.append(el("p", "ffrd__empty", "Select a folder to see what belongs in it."));
  }

  /* ---- Templates and Resources sections: folders and files only ---- */
  function initFiles() {
    var base = typeof __md_scope !== "undefined" ? __md_scope : location.href;
    document.querySelectorAll("[data-ffrd-files]").forEach(function (host) {
      if (host.dataset.ready) return;
      host.dataset.ready = "1";
      host.classList.add("ffrd", "ffrd-files");   // .ffrd supplies the shared colours
      fetch(new URL(host.dataset.src, base))
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (data) { renderFiles(host, data); })
        .catch(function () { host.textContent = "The folder tree could not be loaded. Download the zip to see it."; });
    });
  }

  function renderFiles(host, data) {
    if (!data.root.children.length && !data.root.files.length) {
      host.replaceChildren(el("p", "ffrd__empty", host.dataset.empty || "Nothing has been added yet."));
      return;
    }
    var toggles = [];   // [row, kids] for every folder that has something inside
    var folders = 0, files = 0;

    function setOpen(t, open) {
      t[1].hidden = !open;
      t[0].setAttribute("aria-expanded", open ? "true" : "false");
    }

    function build(node, depth) {
      folders++;
      var li = el("li");
      var empty = !node.children.length && !node.files.length;
      var row = el(empty ? "span" : "button", "ffrd-files__row is-folder");
      row.append(el("span", "ffrd-icon ffrd-icon--folder"), el("span", null, node.name));
      li.append(row);
      if (empty) return li;

      row.type = "button";
      var kids = el("ul", "ffrd-files__kids");
      node.children.forEach(function (c) { kids.append(build(c, depth + 1)); });
      node.files.forEach(function (name) {
        files++;
        var f = el("li");
        var frow = el("span", "ffrd-files__row is-file");
        frow.append(el("span", "ffrd-icon ffrd-icon--file"), el("span", null, name));
        f.append(frow);
        kids.append(f);
      });
      li.append(kids);
      var t = [row, kids];
      toggles.push(t);
      setOpen(t, depth === 0);
      row.addEventListener("click", function () { setOpen(t, kids.hidden); });
      return li;
    }

    var tree = el("ul", "ffrd-files__tree");
    tree.append(build(data.root, 0));
    var root = toggles[toggles.length - 1];   // pushed last: its children are built first

    var bar = el("div", "ffrd__bar");
    var expand = el("button", "ffrd__btn", "Expand all");
    var collapse = el("button", "ffrd__btn", "Collapse all");
    expand.type = collapse.type = "button";
    expand.addEventListener("click", function () { toggles.forEach(function (t) { setOpen(t, true); }); });
    collapse.addEventListener("click", function () { toggles.forEach(function (t) { setOpen(t, t === root); }); });
    bar.append(expand, collapse, el("span", "ffrd__count",
      folders + " folders, " + files + (files === 1 ? " file" : " files")));
    host.replaceChildren(bar, tree);
  }

  /* ---- Image popup: fits the window; click the image for full size ---- */
  var popup = null;   // {dialog, title, view, img, full}, built on first use

  function openPopup(link) {
    if (!popup) {
      var dialog = el("dialog", "ffrd-popup");
      var head = el("div", "ffrd-popup__head");
      var title = el("strong", "ffrd-popup__title");
      var hint = el("span", "ffrd-popup__hint", "Click the image to zoom");
      var full = el("a", "ffrd__btn", "Open full size");
      full.target = "_blank";
      full.rel = "noopener";
      var close = el("button", "ffrd__btn", "Close");
      close.type = "button";
      close.addEventListener("click", function () { dialog.close(); });
      head.append(title, hint, full, close);
      var view = el("div", "ffrd-popup__view");
      var img = el("img", "ffrd-popup__img");
      img.addEventListener("click", function () { view.classList.toggle("is-full"); });
      view.append(img);
      dialog.append(head, view);
      // A click on the backdrop lands on the dialog itself, not on its contents
      dialog.addEventListener("click", function (ev) { if (ev.target === dialog) dialog.close(); });
      document.body.append(dialog);
      popup = { dialog: dialog, title: title, view: view, img: img, full: full };
    }
    var name = link.dataset.title || link.textContent.trim();
    popup.title.textContent = name;
    popup.img.alt = name;
    popup.img.src = link.href;
    popup.full.href = link.href;
    popup.view.classList.remove("is-full");
    popup.dialog.showModal();
  }

  document.addEventListener("click", function (ev) {
    var link = ev.target.closest && ev.target.closest("a[data-ffrd-popup]");
    if (!link || ev.ctrlKey || ev.metaKey || ev.shiftKey || !window.HTMLDialogElement) return;
    ev.preventDefault();
    openPopup(link);
  });

  function start() { init(); initFiles(); }
  if (window.document$ && document$.subscribe) document$.subscribe(start);
  else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
