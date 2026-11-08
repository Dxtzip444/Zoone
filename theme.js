// Zoone for Spicetify (after the Zune desktop software): behaviour layer
// Copyright (C) 2026 Dxtzip
// SPDX-License-Identifier: GPL-3.0-only
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU General Public License, version 3, as published
// by the Free Software Foundation. It comes WITHOUT ANY WARRANTY; see LICENSE.
// Adds the Zune pivots, the SETTINGS | HELP links, the VOLUME readout, the
// black Quickplay home screen, the full-window "mix view" now playing and the
// settings page. Everything here is plain DOM added next to Spotify's own
// nodes; nothing Spotify renders is moved or rewritten.
(function ZuneTheme() {
  "use strict";

  const S = window.Spicetify;
  // Recent clients expose the native player through the registry before
  // Spicetify finishes loading its webpack helpers. Let its player bridge
  // attach then, instead of leaving the entire theme waiting indefinitely.
  if (S?.Player && !("origin" in S.Player) && S?.Platform?.PlayerAPI?._state) {
    S.Player.origin = S.Platform.PlayerAPI;
  }
  let playerReady = false;
  try {
    playerReady = typeof S?.Player?.isPlaying?.() === "boolean";
  } catch (_) {
    // The wrapper exposes its methods before the player's internal state.
  }
  if (
    !playerReady ||
    !S?.Platform?.History ||
    !S?.Player?.addEventListener ||
    !S?.LocalStorage ||
    !document.getElementById("global-nav-bar") ||
    !document.querySelector('aside[data-testid="now-playing-bar"]')
  ) {
    setTimeout(ZuneTheme, 200);
    return;
  }
  if (window.__zuneTheme) return;
  window.__zuneTheme = true;

  const root = document.documentElement;
  const History = S.Platform.History;

  /* ------------------------------------------------------------------ */
  /* helpers                                                             */
  /* ------------------------------------------------------------------ */
  const $ = (sel, scope = document) => scope.querySelector(sel);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const currentPath = () => History.location?.pathname || "/";
  const mq = (q) => {
    try {
      return window.matchMedia(q).matches;
    } catch (_) {
      return false;
    }
  };

  function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) node.append(c);
    return node;
  }

  // Names that open their page, one link per artist, comma separated. The
  // links carry data-uri, so right-click gives that artist's menu. Inside a
  // listbox they take no Tab stop (the list owns the keys); elsewhere Tab
  // reaches them and Enter follows them.
  function nameLinks(list, focusable = true) {
    const out = [];
    for (const a of list || []) {
      if (!a?.name) continue;
      if (out.length) out.push(", ");
      out.push(a.uri ? h("span", { class: "zb-go", role: "link", tabindex: focusable ? "0" : null, "data-go": a.uri, "data-uri": a.uri, "data-name": a.name, "data-artist": a.artist || null, text: a.name }) : a.name);
    }
    return out;
  }
  // the same for a node that a virtual list repaints: rebuilt only on change
  function fillLinks(cell, list, focusable = false) {
    const key = (list || []).map((a) => `${a?.uri}|${a?.name}|${a?.artist || ""}`).join(";");
    if (cell._links === key) return;
    cell._links = key;
    cell.replaceChildren(...nameLinks(list, focusable));
  }

  function replaceKeepingFocus(old, fresh) {
    const active = old?.contains(document.activeElement) ? document.activeElement : null;
    const name = active && (active.getAttribute("aria-label") || active.textContent);
    old.replaceWith(fresh);
    if (name) [...fresh.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || b.textContent) === name)?.focus({ preventScroll: true });
  }

  const ICON = {
    back: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7.6 2.4 2 8l5.6 5.6 1.1-1.1L5 8.8h9V7.2H5l3.7-3.7z"/></svg>',
    play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.5v11l9-5.5z"/></svg>',
    go: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8.4 2.4 7.3 3.5l3.7 3.7H2v1.6h9l-3.7 3.7 1.1 1.1L14 8z"/></svg>',
    pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>',
    prev: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 2.5h1.8v11H2.5zM13.5 2.5v11L5.2 8z"/></svg>',
    next: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.7 2.5h1.8v11h-1.8zM2.5 2.5v11L10.8 8z"/></svg>',
    heart:
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 14.3 6.9 13.3C2.9 9.7.5 7.5.5 4.8.5 2.6 2.2.9 4.4.9c1.3 0 2.6.6 3.6 1.6C9 1.5 10.3.9 11.6.9c2.2 0 3.9 1.7 3.9 3.9 0 2.7-2.4 4.9-6.4 8.5z"/></svg>',
  };

  // spotify:image:<id> -> https://i.scdn.co/image/<id>
  function imageUrl(u) {
    if (!u || typeof u !== "string") return null;
    if (u.startsWith("spotify:image:")) return `https://i.scdn.co/image/${u.slice(14)}`;
    if (u.startsWith("https://")) return u;
    return null;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function normHex(v) {
    const s = String(v || "").trim().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(s)) return `#${s.replace(/./g, (c) => c + c)}`.toLowerCase();
    if (/^[0-9a-f]{6}$/i.test(s)) return `#${s}`.toLowerCase();
    return null;
  }

  function hexToRgb(hex) {
    const n = normHex(hex);
    if (!n) return null;
    const v = parseInt(n.slice(1), 16);
    return `${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}`;
  }

  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0.08, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let hue;
    if (max === r) hue = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    return [hue / 6, s, l];
  }

  function debounce(fn, ms) {
    let t = 0;
    const run = (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
    run.flush = () => {
      clearTimeout(t);
      fn();
    };
    return run;
  }

  function notify(msg, isError = false) {
    try {
      S.showNotification?.(msg, isError);
    } catch (_) {
      /* no notifications */
    }
  }

  async function copyText(text) {
    try {
      if (S.Platform.ClipboardAPI?.copy) {
        await S.Platform.ClipboardAPI.copy(text);
        return true;
      }
    } catch (_) {
      /* fall through */
    }
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      return false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* scheme                                                              */
  /* ------------------------------------------------------------------ */
  // Read light/dark from the scheme's actual main colour, so custom schemes
  // work and `spicetify refresh` (which keeps the old scheme name) is fine.
  // BASE_SCHEME is the one Spicetify applied (colors.css). The one on screen
  // follows Settings > colors > theme; the other scheme's colours ship in
  // user.css as html.zune-palette-light / -dark (generated from color.ini).
  const BASE_SCHEME = (() => {
    const rgb = getComputedStyle(root).getPropertyValue("--spice-rgb-main").split(",").map(Number);
    if (rgb.length === 3 && rgb.every((n) => Number.isFinite(n))) {
      return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] < 128 ? "dark" : "light";
    }
    return String(S.Config?.color_scheme || "").toLowerCase().includes("dark") ? "dark" : "light";
  })();
  let schemeKey = BASE_SCHEME;
  let isDarkScheme = schemeKey === "dark";
  root.classList.add("zune-js", `zune-scheme-${schemeKey}`);

  // A scheme's own colours. The applied one is the last :root rule that sets
  // --spice-main: Spicetify's colors.css, or the <style> the Spicetify
  // Marketplace injects when it installed the theme. The other scheme is the
  // html.zune-palette-* rule from user.css, which also arrives as a link or
  // as Marketplace's <style>. Matching rules, not file names, covers both.
  const schemeColorCache = {};
  function schemeColors(key = schemeKey) {
    if (schemeColorCache[key]) return schemeColorCache[key];
    const own = key === BASE_SCHEME;
    const wanted = `html.zune-palette-${key}`;
    let out = {};
    for (const ss of document.styleSheets) {
      let rules;
      try {
        rules = ss.cssRules;
      } catch (_) {
        continue; // cross-origin sheet
      }
      for (const rule of rules) {
        if (!rule.style) continue;
        const match = own ? rule.selectorText === ":root" && rule.style.getPropertyValue("--spice-main") : rule.selectorText === wanted;
        if (!match) continue;
        const found = {};
        for (const name of rule.style) if (name.startsWith("--spice-")) found[name] = rule.style.getPropertyValue(name).trim();
        out = own ? { ...out, ...found } : found; // later sheets win, as in the cascade
      }
    }
    if (Object.keys(out).length) schemeColorCache[key] = out;
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* settings schema                                                     */
  /* ------------------------------------------------------------------ */
  // kind: toggle | range | choice | text | color
  // css: custom property written on <html> (value + cssUnit)
  // cls: class on <html> while the value is true (or false, with inverse)
  // choiceClass: { option: className }
  // scheme: colour stored per scheme (light / dark); vars are the --spice-*
  //         names it overrides, so Spotify's own accent follows too.
  const MOTION_DEFAULT = mq("(prefers-reduced-motion: reduce)") ? "reduced" : "full";
  const HC_DEFAULT = mq("(prefers-contrast: more)");
  const WALLPAPER_RE = /^(https:\/\/\S+|data:image\/[a-z+.-]+;base64,[a-z0-9+/=\s]+)$/i;

  const CATEGORIES = [
    { id: "colors", label: "colors" },
    { id: "background", label: "background" },
    { id: "type", label: "type" },
    { id: "layout", label: "layout" },
    { id: "collection", label: "collection" },
    { id: "pivots", label: "pivots" },
    { id: "player", label: "player" },
    { id: "menus", label: "menus" },
    { id: "nowplaying", label: "now playing" },
    { id: "quickplay", label: "quickplay" },
    { id: "motion", label: "motion" },
    { id: "backup", label: "backup" },
    { id: "help", label: "help" },
  ];

  const METRO = [
    ["zune magenta", "#ec008c"],
    ["magenta", "#ff0097"],
    ["purple", "#a200ff"],
    ["teal", "#00aba9"],
    ["lime", "#8cbf26"],
    ["brown", "#a05000"],
    ["pink", "#e671b8"],
    ["orange", "#f09609"],
    ["blue", "#1ba1e2"],
    ["red", "#e51400"],
    ["green", "#339933"],
    ["graphite", "#4d4d4d"],
  ];

  const toggle = (key, cat, def, label, extra = {}) => ({ key, cat, kind: "toggle", def, label, ...extra });
  const range = (key, cat, def, min, max, step, label, extra = {}) => ({ key, cat, kind: "range", def, min, max, step, label, ...extra });
  const choice = (key, cat, def, options, label, extra = {}) => ({ key, cat, kind: "choice", def, options, label, ...extra });
  const text = (key, cat, def, label, extra = {}) => ({ key, cat, kind: "text", def, label, ...extra });

  const SCHEMA = [
    // colours
    choice("appearance", "colors", BASE_SCHEME, [["light", "light"], ["dark", "dark"], ["system", "match system"]], "Theme", { help: "Light is Zune's white canvas, dark is black. Every page uses it, Quickplay included. Each theme keeps its own colours below." }),
    { key: "accent", cat: "colors", kind: "color", scheme: true, palette: true, fallback: "#ec008c", vars: ["zune-accent", "button", "button-active", "notification"], label: "Accent", help: "Selection, toggles, the avatar tile, and Spotify's own accent." },
    { key: "accentLineColor", cat: "colors", kind: "color", scheme: true, palette: true, follows: "accent", vars: ["zune-line-accent"], label: "Accent lines", help: "The corner stripe, tab underlines, focus borders and the progress line on hover. Follows Accent until you pick a colour here." },
    { key: "accent2", cat: "colors", kind: "color", scheme: true, fallback: "#f7941d", vars: ["zune-accent-2"], label: "Gradient end", help: "The orange that accent lines fade to, and the second corner glow." },
    choice("accentLines", "colors", "gradient", [["gradient", "zune gradient"], ["solid", "one colour"]], "Line style", { choiceClass: { solid: "zune-lines-solid" }, help: "Zune's lines fade from magenta to orange. One colour drops the fade." }),
    { key: "pivotColor", cat: "colors", kind: "color", scheme: true, fallback: "#949494", vars: ["zune-pivot"], label: "Inactive pivots", help: "The big pivot words you are not on." },
    { key: "lineColor", cat: "colors", kind: "color", scheme: true, fallback: "#dcdcdc", vars: ["zune-line"], label: "Hairlines", help: "Scrollbar tracks, input borders, the progress line." },
    { key: "qpPivotColor", cat: "colors", kind: "color", scheme: true, fallback: "#666666", vars: ["qp-pivot"], label: "Quickplay grey", help: "Pivots and section titles on the black screens." },
    toggle("highContrast", "colors", HC_DEFAULT, "High contrast", { cls: "zune-hc", help: "Darker grey text and readable inactive pivots." }),

    // background
    text("wallpaper", "background", "", "Background picture", { stacked: true, max: 1500000, placeholder: "https://… image URL", help: "Shown behind the app, like Zune's custom backgrounds. Leave empty for the default.", validate: (v) => (v === "" || WALLPAPER_RE.test(v) ? null : "Use an https:// image URL.") }),
    range("wallpaperDim", "background", 0.55, 0, 1, 0.05, "Picture wash", { css: "--zune-wallpaper-dim", fmt: "pct", help: "How much of the canvas colour covers the picture." }),
    range("canvasGlow", "background", 0.075, 0, 0.2, 0.005, "Corner glow", { css: "--zune-glow", fmt: "pct", help: "The accent-coloured glows in the corners." }),
    toggle("halftone", "background", true, "Halftone dots", { cls: "zune-no-halftone", inverse: true, help: "The dot pattern at the bottom right." }),
    range("halftoneOpacity", "background", 0.11, 0, 0.3, 0.01, "Dot strength", { css: "--zune-halftone-opacity", fmt: "pct" }),
    toggle("stripe", "background", true, "Corner stripe", { cls: "zune-no-stripe", inverse: true, help: "The magenta-to-orange bar beside the pivots." }),
    range("stripeWidth", "background", 10, 2, 16, 1, "Stripe width", { css: "--zune-stripe-width", cssUnit: "px", unit: "px" }),
    toggle("squareCorners", "background", true, "Square corners", { cls: "zune-round", inverse: true, help: "Off brings back rounded corners." }),
    toggle("flatHeaders", "background", true, "Flat page headers", { cls: "zune-keep-headers", inverse: true, help: "Remove Spotify's colour washes behind album, playlist and artist headers." }),

    // type
    choice("font", "type", "zune", [["zune", "segoe ui or selawik"], ["selawik", "selawik"], ["spotify", "spotify"], ["custom", "custom"]], "Font", { help: "Selawik is bundled; Segoe UI is used when it is installed." }),
    text("customFont", "type", "", "Custom font family", { max: 80, live: true, placeholder: "e.g. Avenir Next", help: "An installed font's family name. Used when the font is custom." }),
    toggle("lowercaseTitles", "type", true, "Lowercase section titles", { cls: "zune-keep-case", inverse: true, help: "Zune wrote headings in lowercase. Off keeps names as written." }),
    range("sectionTitleSize", "type", 30, 20, 40, 1, "Section title size", { css: "--zune-section-size", cssUnit: "px", unit: "px" }),
    choice("pivotWeight", "type", "300", [["300", "light"], ["400", "regular"]], "Pivot weight", { css: "--zune-pivot-weight", help: "Regular reads better on low-resolution screens." }),

    // layout
    choice("headerSize", "layout", "compact", [["compact", "compact"], ["large", "large"]], "Page headers", { choiceClass: { large: "zune-large-headers" }, help: "Compact keeps more of the list on screen, like Zune's collection view." }),
    choice("trackRowHeight", "layout", "46", [["40", "compact"], ["46", "normal"], ["56", "roomy"]], "Track row height", { css: "--zune-row-height", cssUnit: "px" }),
    toggle("pagesFullWidth", "layout", true, "Full-window pages", { help: "Quickplay, Social and Browse cover the library and the right panel while open, as Zune's pages filled the window." }),
    range("searchWidth", "layout", 250, 160, 360, 10, "Search box width", { css: "--zune-search-width", cssUnit: "px", unit: "px" }),
    choice("scrollbars", "layout", "always", [["always", "always visible"], ["auto", "auto-hide"]], "Scrollbars", { choiceClass: { auto: "zune-scroll-auto" }, help: "Zune kept its scrollbars on screen." }),
    toggle("horizontalScrollbars", "layout", true, "Horizontal scrollbars", { cls: "zune-no-hscroll", inverse: true, help: "For wide track lists and the library filter row." }),

    // collection browser
    toggle("collectionBrowser", "collection", true, "Zune collection view", { help: "collection opens ARTISTS | ALBUMS | SONGS columns instead of Spotify's Liked Songs page." }),
    choice("browserArtists", "collection", "collection", [["collection", "everyone in your collection"], ["followed", "artists you follow"]], "Artists column", { help: "Zune listed every artist you had music by. Nobody is followed or unfollowed either way." }),
    choice("browserView", "collection", "artists", [["artists", "artists"], ["albums", "albums"], ["songs", "songs"], ["playlists", "playlists"]], "Opens on"),
    toggle("browserFullWidth", "collection", true, "Full width", { help: "Cover the library sidebar and Spotify's right panel, as Zune's collection filled the window." }),
    choice("browserRowHeight", "collection", "28", [["24", "compact"], ["28", "normal"], ["34", "roomy"]], "Row height", { css: "--zune-browser-row", cssUnit: "px" }),
    choice("playingHighlight", "collection", "gradient", [["mark", "Zune mark"], ["gradient", "soft gradient"]], "Playing highlight", { help: "Small Zune bars, with an optional static wash using Accent lines and Gradient end. Focus and selection stay separate." }),
    range("albumTileSize", "collection", 104, 72, 160, 4, "Album size", { css: "--zune-album-tile", cssUnit: "px", unit: "px" }),

    // pivots
    range("pivotSize", "pivots", 34, 24, 44, 1, "Pivot size", { css: "--zune-pivot-size", cssUnit: "px", unit: "px" }),
    toggle("showSubPivots", "pivots", true, "Sub-pivots", { cls: "zune-no-subpivots", inverse: true, help: "The MUSIC PODCASTS … row under the pivots." }),
    toggle("marketplaceSwap", "pivots", true, "Big sub-pivots in marketplace", { help: "As in Zune, marketplace shrinks the pivots and enlarges its sub-pivots." }),
    choice("collectionTarget", "pivots", "/collection/tracks", [["/collection/tracks", "liked songs"], ["/collection/episodes", "your episodes"], ["/collection/local-files", "local files"]], "Collection opens"),
    toggle("showLinks", "pivots", true, "SETTINGS | HELP links", { cls: "zune-no-links", inverse: true, help: "The theme settings stay in the profile menu." }),
    toggle("showUser", "pivots", true, "User name and collection count", { cls: "zune-no-user", inverse: true }),
    toggle("showAppGlyphs", "pivots", true, "Custom app icons", { cls: "zune-no-appglyphs", inverse: true, help: "Marketplace and other Spicetify apps beside the back button." }),
    choice("socialView", "pivots", "zune", [["zune", "zune me page"], ["spotify", "spotify profile"]], "Social page", { help: "Zune's me page: your profile card, recent songs, favorites and top tracks in columns, and a row of friends. Or Spotify's profile." }),
    choice("browseView", "pivots", "zune", [["zune", "zune browse"], ["spotify", "spotify browse"]], "Browse page", { help: "Zune's marketplace page: a genres list, featured tiles, new releases from artists you follow, and the top 50. Or Spotify's own." }),
    text("labelQuickplay", "pivots", "quickplay", "Quickplay", { section: "labels", max: 30, live: true }),
    text("labelCollection", "pivots", "collection", "Collection", { max: 30, live: true }),
    text("labelMarketplace", "pivots", "marketplace", "Marketplace", { max: 30, live: true }),
    text("labelSocial", "pivots", "social", "Social", { max: 30, live: true }),

    // player
    toggle("zuneIcons", "player", true, "Zune icons", { cls: "zune-icons", help: "Thin Zune-style glyphs for previous, next, repeat, shuffle, the hearts (Spotify's saved checks), download as Zune's sync, search, and the device, playlist and lyrics buttons." }),
    choice("volumeControl", "player", "both", [["zune", "volume readout"], ["spotify", "spotify slider"], ["both", "both"]], "Volume control", { choiceClass: { zune: "zune-vol-zune", spotify: "zune-vol-spotify", both: "zune-vol-both" }, help: "The volume number sits below the slider in the left tray." }),
    toggle("wheelVolume", "player", true, "Scroll to change volume", { help: "Scroll over VOLUME to change it." }),
    range("volumeStep", "player", 2, 1, 10, 1, "Volume step", { unit: "%" }),
    toggle("showNowPlayingButton", "player", true, "Now playing button", { cls: "zune-no-npbtn", inverse: true, help: "The pink bars that open the mix view." }),
    toggle("heartUnlikes", "player", true, "Heart removes a like", { help: "Clicking a filled heart takes the song out of Liked Songs at once, as in Zune. Option-click (Alt-click) still opens Spotify's playlist picker. Off: the heart always opens the picker." }),
    toggle("coverOpensMixView", "player", true, "Album art opens now playing", { help: "Clicking the art in the player bar opens the mix view. Off opens Spotify's now playing panel instead." }),
    toggle("showBadges", "player", true, "Quality badge", { cls: "zune-no-badges", inverse: true, help: "Lossless and similar labels beside the artist name." }),
    range("barHeight", "player", 86, 72, 100, 2, "Bar height", { css: "--zune-bar-height", cssUnit: "px", unit: "px" }),
    toggle("trayLyrics", "player", true, "Lyrics", { section: "left tray buttons", cls: "zune-hide-x-lyrics", inverse: true }),
    toggle("trayQueue", "player", true, "Queue", { cls: "zune-hide-x-queue", inverse: true }),
    toggle("trayConnect", "player", true, "Devices", { cls: "zune-hide-x-connect", inverse: true }),
    toggle("trayPip", "player", true, "Mini player", { cls: "zune-hide-x-pip", inverse: true }),
    toggle("trayFullscreen", "player", true, "Full screen", { cls: "zune-hide-x-fullscreen", inverse: true }),

    // now playing (mix view)
    toggle("mosaicFlip", "nowplaying", true, "Flip tiles", { section: "mosaic" }),
    range("flipInterval", "nowplaying", 1.4, 0.5, 5, 0.1, "Flip every", { unit: " s" }),
    range("tileSize", "nowplaying", 118, 80, 200, 2, "Tile size", { css: "--zune-tile-size", cssUnit: "px", unit: "px" }),
    toggle("mosaicColor", "nowplaying", false, "Keep album colours", { cls: "zune-mix-color", help: "Off draws the mosaic in greyscale under the tint, like Zune." }),
    choice("tint", "nowplaying", "album", [["album", "from album art"], ["accent", "accent"], ["custom", "custom"], ["none", "none"]], "Tint"),
    { key: "tintColor", cat: "nowplaying", kind: "color", def: "#7a4a1c", label: "Custom tint", help: "Used when the tint is custom." },
    range("tintStrength", "nowplaying", 1, 0, 1, 0.05, "Tint strength", { css: "--zune-tint-strength", fmt: "pct" }),
    toggle("sourceLibrary", "nowplaying", true, "Your saved albums", { section: "mosaic pictures" }),
    toggle("sourceQueue", "nowplaying", true, "The queue"),
    toggle("sourceRelated", "nowplaying", true, "Related artists"),
    toggle("showArtistPhoto", "nowplaying", true, "Artist photos", { section: "panels", cls: "zune-mix-no-photo", inverse: true }),
    range("photoInterval", "nowplaying", 9, 3, 30, 1, "Next photo every", { unit: " s" }),
    toggle("showQueue", "nowplaying", true, "Up next list", { cls: "zune-mix-no-queue", inverse: true }),
    range("queueLength", "nowplaying", 14, 5, 25, 1, "Up next length", { unit: "" }),
    toggle("idleNowPlaying", "nowplaying", true, "Open when idle", { section: "opens by itself", help: "Like Zune, now playing takes over after a while without mouse or keyboard input." }),
    range("idleMinutes", "nowplaying", 5, 1, 30, 1, "Idle time", { unit: " min" }),
    toggle("idleOnlyPlaying", "nowplaying", true, "Only while music plays"),
    toggle("idleCloseOnActivity", "nowplaying", false, "Close on activity", { help: "When it opened by itself, moving the mouse or pressing a key closes it again, like a screen saver." }),
    toggle("showLabel", "nowplaying", false, '"now playing" title', { cls: "zune-mix-label", help: "Zune's mix view had no title. On adds one beside the back circle." }),

    // quickplay
    choice("quickplayView", "quickplay", "zune", [["zune", "zune quickplay"], ["spotify", "spotify home"]], "Quickplay page", { help: "Zune's start screen: smart dj, pins, new and history, scrolling sideways. Or Spotify's Home." }),
    range("quickplayDjCount", "quickplay", 8, 0, 12, 1, "Smart DJ tiles", { help: "Your most recently played artists, as big tiles that start the artist's Spotify radio." }),
    toggle("smartDjBetterMix", "quickplay", false, "Better Mix smart dj", {
      available: () => typeof window.BetterMix?.buildFrom === "function",
      help: "Smart dj starts the artist's Spotify radio while Better Mix builds its own version of that radio. Better Mix's songs then play from the next song on, and the radio carries on after them. Shown because the Better Mix extension is installed.",
    }),
    range("quickplayTile", "quickplay", 112, 80, 160, 4, "Tile size", { css: "--zune-qp-tile", cssUnit: "px", unit: " px" }),
    toggle("quickplayDark", "quickplay", false, "Black quickplay", { help: "Home turns black while the other pages stay light, as in Zune. Light theme only." }),
    choice("quickplayScope", "quickplay", "window", [["window", "whole window"], ["main", "main view only"]], "Black area"),
    toggle("quickplayBigTitles", "quickplay", true, "Giant section titles", { cls: "zune-qp-small-titles", inverse: true, help: "The big grey words, like pins, history and new." }),

    // right-click menus
    toggle("menusOn", "menus", true, "Right-click menus", { cls: "zune-menus-off", inverse: true, help: "Right-click a song, album, artist or playlist on Zoone's pages (quickplay, collection, social, browse, now playing) for Zune's menu. Spotify's own pages keep Spotify's menu." }),
    toggle("menuPlay", "menus", true, "Play", { section: "what the menu offers" }),
    toggle("menuPlayNext", "menus", true, "Play next"),
    toggle("menuQueue", "menus", true, "Add to now playing"),
    toggle("menuPlaylist", "menus", true, "Add to playlist", { help: "A list of your own playlists." }),
    toggle("menuAlbum", "menus", true, "Go to album"),
    toggle("menuArtist", "menus", true, "Go to artist"),
    toggle("menuSave", "menus", true, "Add to collection", { help: "Or remove from collection: likes a song, saves an album or playlist, follows an artist." }),
    toggle("menuPin", "menus", true, "Pin to quickplay", { help: "Pins it in Your Library, so it shows under quickplay's pins." }),
    toggle("menuDj", "menus", true, "Start smart DJ", { help: "Plays the artist's Spotify radio, like quickplay's smart dj tiles." }),
    toggle("menuCopy", "menus", true, "Copy link"),

    // motion
    choice("motion", "motion", MOTION_DEFAULT, [["full", "full"], ["reduced", "reduced"], ["off", "off"]], "Motion", { choiceClass: { full: "zune-motion-full", reduced: "zune-motion-reduced", off: "zune-motion-off" }, help: "Reduced fades instead of moving and blurring. Off stops all theme animation. The default follows your system setting." }),
    choice("enterStyle", "motion", "blur", [["blur", "blur up"], ["slide", "slide"], ["fade", "fade"]], "Entrances", { choiceClass: { slide: "zune-enter-slide", fade: "zune-enter-fade" }, help: "How new screens arrive. Blur up fades in from nothing, rising into place. Slide is Zune's sideways move." }),
    choice("enterCurve", "motion", "out", [["out", "fast into slow"], ["in", "slow into fast"], ["smooth", "smooth"], ["linear", "even"]], "Curve", { choiceClass: { in: "zune-curve-in", smooth: "zune-curve-smooth", linear: "zune-curve-linear" }, help: "Fast into slow settles each piece into place, as Metro did." }),
    range("slideDuration", "motion", 0.4, 0.2, 1, 0.05, "Animation length", { css: "--zune-slide-duration", cssUnit: "s", unit: " s" }),
    range("enterBlur", "motion", 10, 0, 24, 1, "Blur", { css: "--zune-enter-blur", cssUnit: "px", unit: " px", help: "How soft things start in blur up." }),
    range("enterRise", "motion", 16, 0, 40, 1, "Rise", { css: "--zune-enter-rise", cssUnit: "px", unit: " px", help: "How far below its place each piece starts." }),
    range("enterStagger", "motion", 35, 0, 80, 5, "Stagger", { css: "--zune-enter-stagger", cssUnit: "ms", unit: " ms", help: "The delay between one piece and the next: art, titles, rows, cards." }),
    toggle("pageEntrances", "motion", true, "Page entrances", { help: "Each part of a Spotify page animates in as it loads, not the page as a whole." }),
  ];

  const BY_KEY = new Map(SCHEMA.map((d) => [d.key, d]));
  const DEFAULTS = Object.fromEntries(SCHEMA.filter((d) => !d.scheme).map((d) => [d.key, d.def]));

  function validateValue(def, v) {
    switch (def.kind) {
      case "toggle":
        return typeof v === "boolean" ? null : "must be true or false";
      case "range":
        return typeof v === "number" && Number.isFinite(v) && v >= def.min && v <= def.max ? null : `must be a number from ${def.min} to ${def.max}`;
      case "choice":
        return def.options.some((o) => o[0] === v) ? null : `must be one of ${def.options.map((o) => o[0]).join(", ")}`;
      case "color":
        return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? null : "must be a #rrggbb colour";
      case "text":
        if (typeof v !== "string") return "must be text";
        if (v.length > (def.max || 200)) return "is too long";
        return def.validate ? def.validate(v) : null;
      default:
        return "is not a setting";
    }
  }

  // strict: reject on the first problem (import); otherwise drop bad keys (load)
  function checkStore(raw, strict) {
    const values = {};
    const colors = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      if (strict) throw new Error("This is not a Zoone settings export.");
      return { values, colors };
    }
    const fail = (msg) => {
      if (strict) throw new Error(msg);
    };
    const isPlain = (o) => o != null && typeof o === "object" && !Array.isArray(o);
    if (strict) {
      for (const k of Object.keys(raw)) if (!["version", "values", "colors"].includes(k)) fail(`Unknown field "${k}". This does not look like a Zoone export.`);
      if (raw.version !== VERSION) fail(`Unsupported version ${JSON.stringify(raw.version)}; expected ${VERSION}.`);
      if (!("values" in raw) && !("colors" in raw)) fail("The export has no values or colors.");
      if ("values" in raw && !isPlain(raw.values)) fail('"values" must be an object.');
      if ("colors" in raw && !isPlain(raw.colors)) fail('"colors" must be an object.');
    }
    for (const [k, v] of Object.entries(isPlain(raw.values) ? raw.values : {})) {
      const def = BY_KEY.get(k);
      if (!def || def.scheme) {
        fail(`Unknown setting "${k}".`);
        continue;
      }
      const err = validateValue(def, v);
      if (err) fail(`"${k}" ${err}.`);
      else values[k] = v;
    }
    for (const [scheme, map] of Object.entries(isPlain(raw.colors) ? raw.colors : {})) {
      if (scheme !== "light" && scheme !== "dark") {
        fail(`Unknown scheme "${scheme}". Use light or dark.`);
        continue;
      }
      if (!isPlain(map)) {
        fail(`Colours for "${scheme}" are not an object.`);
        continue;
      }
      for (const [k, v] of Object.entries(map)) {
        const def = BY_KEY.get(k);
        if (!def || !def.scheme) {
          fail(`Unknown colour "${k}".`);
          continue;
        }
        const hex = normHex(v);
        if (!hex) fail(`Colour "${k}" must be #rrggbb.`);
        else (colors[scheme] ||= {})[k] = hex;
      }
    }
    return { values, colors };
  }

  /* ------------------------------------------------------------------ */
  /* storage                                                             */
  /* ------------------------------------------------------------------ */
  const STORE_KEY = "zune:settings";
  const VERSION = 2;

  function loadStore() {
    let raw = null;
    try {
      raw = JSON.parse(S.LocalStorage.get(STORE_KEY) || "null");
    } catch (_) {
      raw = null;
    }
    if (raw && typeof raw === "object" && !raw.version) {
      // version 1 kept four flat keys
      const values = {};
      if (typeof raw.quickplayDark === "boolean") values.quickplayDark = raw.quickplayDark;
      if (typeof raw.mosaicFlip === "boolean") values.mosaicFlip = raw.mosaicFlip;
      if (typeof raw.wallpaper === "string") values.wallpaper = raw.wallpaper;
      if (raw.motion === false) values.motion = "reduced";
      raw = { version: VERSION, values, colors: {} };
    }
    return checkStore(raw, false);
  }

  const loaded = loadStore();
  const settings = { ...DEFAULTS, ...loaded.values };
  const prefersDark = () => mq("(prefers-color-scheme: dark)");
  const wantScheme = () => (settings.appearance === "system" ? (prefersDark() ? "dark" : "light") : settings.appearance === "dark" ? "dark" : "light");
  schemeKey = wantScheme();
  isDarkScheme = schemeKey === "dark";
  let storedColors = loaded.colors; // { light: {...}, dark: {...} }
  let colorOverrides = { ...(storedColors[schemeKey] || {}) };

  function exportObject() {
    const values = {};
    for (const [k, v] of Object.entries(settings)) if (BY_KEY.has(k) && v !== DEFAULTS[k]) values[k] = v;
    const colors = { ...storedColors };
    if (Object.keys(colorOverrides).length) colors[schemeKey] = { ...colorOverrides };
    else delete colors[schemeKey];
    return { version: VERSION, values, colors };
  }

  function persist() {
    const data = exportObject();
    storedColors = data.colors;
    try {
      S.LocalStorage.set(STORE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      notify(`Zoone: settings could not be saved (${e?.name || "error"}). A large data: picture may not fit.`, true);
      return false;
    }
  }
  const persistSoon = debounce(persist, 300);

  /* ------------------------------------------------------------------ */
  /* applying settings                                                   */
  /* ------------------------------------------------------------------ */
  const appliedVars = new Map();
  function setVar(name, value) {
    if (appliedVars.get(name) === value) return;
    appliedVars.set(name, value);
    if (value == null) root.style.removeProperty(name);
    else root.style.setProperty(name, value);
  }
  function setClass(name, on) {
    if (root.classList.contains(name) !== !!on) root.classList.toggle(name, !!on);
  }

  function applySetting(def) {
    const v = settings[def.key];
    if (def.css) setVar(def.css, `${v}${def.cssUnit || ""}`);
    if (def.cls) setClass(def.cls, def.inverse ? !v : !!v);
    if (def.choiceClass) for (const [opt, c] of Object.entries(def.choiceClass)) setClass(c, v === opt);
  }

  function applyColors() {
    for (const def of SCHEMA) {
      if (!def.scheme) continue;
      const hex = colorOverrides[def.key];
      const rgb = hex ? hexToRgb(hex) : null;
      for (const name of def.vars) {
        setVar(`--spice-${name}`, rgb ? hex : null);
        setVar(`--spice-rgb-${name}`, rgb);
      }
    }
  }

  // Swapping a palette changes every colour in one frame. Spotify's own colour
  // transitions (about 280 elements) would each animate it under a crossfade
  // that already covers it, so they are ended after one frame.
  function swapPalette(change) {
    const run = () => {
      change();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          for (const a of document.getAnimations()) if (a instanceof CSSTransition) a.finish();
        })
      );
    };
    if (booted && settings.motion !== "off" && typeof document.startViewTransition === "function" && !document.hidden) {
      try {
        document.startViewTransition(run);
        return;
      } catch (_) {
        /* fall back to an instant switch */
      }
    }
    run();
  }

  function applyScheme(animate = false) {
    const next = wantScheme();
    const change = () => {
      if (next !== schemeKey) {
        storedColors = exportObject().colors; // keep the outgoing scheme's colours
        schemeKey = next;
        isDarkScheme = next === "dark";
        colorOverrides = { ...(storedColors[next] || {}) };
        settingsPage.refresh();
      }
      setClass("zune-scheme-light", next === "light");
      setClass("zune-scheme-dark", next === "dark");
      setClass("zune-palette-light", next === "light" && BASE_SCHEME !== "light");
      setClass("zune-palette-dark", next === "dark" && BASE_SCHEME !== "dark");
      applyColors();
      updateQuickplay(currentPath(), true);
      browser.onColors();
    };
    if (animate && next !== schemeKey) swapPalette(change);
    else change();
  }

  function applyWallpaper() {
    const wp = String(settings.wallpaper || "").trim();
    const ok = WALLPAPER_RE.test(wp);
    setClass("zune-has-wallpaper", ok);
    setVar("--zune-wallpaper", ok ? `url("${wp.replace(/[\\"\n\r]/g, (c) => encodeURIComponent(c))}")` : null);
  }

  function applyFont() {
    setClass("zune-font-spotify", settings.font === "spotify");
    let stack = null;
    if (settings.font === "selawik") stack = '"Zune Selawik", var(--zune-font-default)';
    if (settings.font === "custom") {
      const name = String(settings.customFont || "").replace(/["\\;{}<>]/g, "").trim();
      if (name) stack = `"${name}", var(--zune-font-default)`;
    }
    setVar("--zune-user-font", stack);
  }

  const PIVOT_KEYS = new Set(["collectionBrowser", "labelQuickplay", "labelCollection", "labelMarketplace", "labelSocial", "collectionTarget", "marketplaceSwap", "showSubPivots", "quickplayView", "socialView"]);
  const QUICKPLAY_KEYS = new Set(["quickplayDark", "quickplayScope"]);

  function onSettingChanged(key) {
    const def = BY_KEY.get(key);
    if (!def) return;
    if (def.scheme) applyColors();
    else applySetting(def);
    if (key === "appearance") applyScheme(true);
    if (key === "wallpaper") applyWallpaper();
    if (key === "font" || key === "customFont") applyFont();
    if (PIVOT_KEYS.has(key)) renderPivots(currentPath(), true);
    if (QUICKPLAY_KEYS.has(key)) updateQuickplay(currentPath());
    if (key === "volumeControl") {
      setVolPop(false);
      renderVolume(true);
    }
    mix.onSettings(key);
    browser.onSettings(key);
    quickplay.onSettings(key);
    social.onSettings(key);
    browse.onSettings(key);
    settingsPage.onLayoutChange();
    window.dispatchEvent(new CustomEvent("zune:settings", { detail: { key, value: def.scheme ? colorOverrides[key] : settings[key] } }));
  }

  function applyEverything() {
    for (const def of SCHEMA) if (!def.scheme) applySetting(def);
    applyScheme(false);
    applyWallpaper();
    applyFont();
    renderPivots(currentPath(), true);
    updateQuickplay(currentPath());
    renderVolume(true);
    mix.onSettings("*");
    browser.onSettings("*");
    quickplay.onSettings("*");
    social.onSettings("*");
    browse.onSettings("*");
  }

  function setValue(key, value) {
    const def = BY_KEY.get(key);
    if (!def || def.scheme) return;
    if (settings[key] === value) return;
    settings[key] = value;
    onSettingChanged(key);
    persistSoon();
  }

  function setSchemeColor(key, hex) {
    const def = BY_KEY.get(key);
    if (!def?.scheme) return;
    const n = normHex(hex);
    const base = schemeValue(def);
    if (!n || n === base) delete colorOverrides[key];
    else colorOverrides[key] = n;
    onSettingChanged(key);
    persistSoon();
  }

  // follows: a colour without its own color.ini key shows (and uses) another
  // setting's colour until the user picks one
  function schemeValue(def) {
    const own = normHex(schemeColors()[`--spice-${def.vars[0]}`]);
    if (own) return own;
    if (def.follows) return colorOverrides[def.follows] || schemeValue(BY_KEY.get(def.follows));
    return def.fallback;
  }

  function resetKey(key) {
    const def = BY_KEY.get(key);
    if (!def) return;
    if (def.scheme) {
      delete colorOverrides[key];
      onSettingChanged(key);
    } else {
      settings[key] = DEFAULTS[key];
      onSettingChanged(key);
    }
    persistSoon();
  }

  /* ------------------------------------------------------------------ */
  /* pivots                                                              */
  /* ------------------------------------------------------------------ */
  const me = S.Platform.username || "";
  const hasApp = (name) => (S.Config?.custom_apps || []).includes(name);

  function clickFriendsPanel() {
    const btn = document.querySelector('#global-nav-bar [data-testid="friend-activity-button"]') || [...document.querySelectorAll("#global-nav-bar button[aria-label]")].find((b) =>
      /friend|listening activity|buddy/i.test(b.getAttribute("aria-label"))
    );
    if (btn) btn.click();
    else notify("Spotify's listening activity control is unavailable in this client.", true);
  }

  function focusSearch() {
    const input = $("#global-nav-bar input[data-top-bar-search]") || $("#global-nav-bar form input");
    input?.focus();
  }

  const PIVOTS = [
    {
      id: "quickplay",
      labelKey: "labelQuickplay",
      path: () => (settings.quickplayView === "zune" ? QP_PATH : "/"),
      match: (p) => isQuickplayPath(p),
      subs: [],
    },
    {
      id: "collection",
      labelKey: "labelCollection",
      path: () => (settings.collectionBrowser ? BROWSER_PATH : settings.collectionTarget),
      match: (p) => p.startsWith("/collection") || p === BROWSER_PATH,
      subs: [
        {
          label: "music",
          get path() {
            return settings.collectionBrowser ? BROWSER_PATH : "/collection/tracks";
          },
          match: (p) => p === BROWSER_PATH || p.startsWith("/collection/tracks"),
        },
        { label: "podcasts", path: "/collection/episodes" },
        { label: "local files", path: "/collection/local-files" },
      ],
    },
    {
      id: "marketplace",
      labelKey: "labelMarketplace",
      path: () => "/search",
      bigSub: true,
      match: (p) =>
        p.startsWith("/search") || p.startsWith("/genre") || p.startsWith("/content-feed") || p.startsWith("/marketplace"),
      subs: [
        { label: "browse", path: "/search", match: (p) => p === "/search" || p.startsWith("/genre") },
        { label: "search", action: focusSearch, match: (p) => p.startsWith("/search/") },
        { label: "new", path: "/content-feed" },
        hasApp("marketplace") ? { label: "apps", path: "/marketplace", sticky: false } : null,
      ].filter(Boolean),
    },
    {
      id: "social",
      labelKey: "labelSocial",
      path: () => (settings.socialView === "zune" ? SOCIAL_PATH : `/user/${me}`),
      match: (p) => p === SOCIAL_PATH || (!!me && (p === `/user/${me}` || p.startsWith(`/user/${me}/`))),
      subs: [
        { label: "friends", action: clickFriendsPanel },
        {
          label: "me",
          get path() {
            return settings.socialView === "zune" ? SOCIAL_PATH : `/user/${me}`;
          },
          match: (p) => p === SOCIAL_PATH || (settings.socialView !== "zune" && p === `/user/${me}`),
        },
        { label: "following", path: `/user/${me}/following` },
        { label: "followers", path: `/user/${me}/followers` },
        { label: "profile", path: `/user/${me}`, match: (p) => settings.socialView === "zune" && p === `/user/${me}` },
      ],
    },
  ];

  const pivotEl = h("nav", { id: "zune-pivot", "aria-label": "Zune pivots" });
  const mainRow = h("div", { class: "zune-pivot-row zune-pivot-main is-big" });
  const subRow = h("div", { class: "zune-pivot-row zune-pivot-sub is-small" });
  pivotEl.append(mainRow, subRow);

  const mainButtons = PIVOTS.map((p) => h("button", { type: "button", "data-id": p.id, onclick: () => History.push(p.path()) }));
  mainRow.append(...mainButtons);

  let activePivot = null;
  let subButtons = [];
  const lastSub = new Map();

  function renderPivots(pathname, force = false) {
    const pivot = PIVOTS.find((p) => p.match(pathname)) || activePivot || PIVOTS[0];
    const pivotChanged = pivot !== activePivot;
    activePivot = pivot;

    const big = !!pivot.bigSub && settings.marketplaceSwap && settings.showSubPivots && pivot.subs.length > 0;
    pivotEl.classList.toggle("sub-is-big", big);
    mainRow.classList.toggle("is-big", !big);
    mainRow.classList.toggle("is-small", big);
    subRow.classList.toggle("is-big", big);
    subRow.classList.toggle("is-small", !big);

    PIVOTS.forEach((p, i) => {
      const b = mainButtons[i];
      const label = String(settings[p.labelKey] || "").trim() || p.id;
      if (b.textContent !== label) b.textContent = label;
      const on = p === pivot;
      b.classList.toggle("is-active", on);
      if (on) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });

    if (pivotChanged || force) {
      subButtons = pivot.subs.map((s) => {
        const b = h("button", { type: "button", text: s.label, onclick: () => (s.action ? s.action() : History.push(s.path)) });
        b._zune = s;
        return b;
      });
      if (!pivotChanged) subRow.classList.remove("zune-enter"); // a relabel, not a new pivot
      subRow.replaceChildren(...subButtons);
      if (pivotChanged) {
        // the buttons are new nodes, so their slide-in starts on its own
        subRow.classList.toggle("zune-enter", subButtons.length > 0);
      }
    }
    let anyOn = false;
    for (const b of subButtons) {
      const s = b._zune;
      const on = s.match ? s.match(pathname) : s.action ? false : pathname === s.path || pathname.startsWith(`${s.path}/`);
      b.classList.toggle("is-active", on);
      if (on) {
        anyOn = true;
        if (s.sticky !== false) lastSub.set(pivot.id, s.label);
        else lastSub.delete(pivot.id);
        b.setAttribute("aria-current", "page");
      } else b.removeAttribute("aria-current");
    }
    // On a detail page (album, artist ...) keep the sub-pivot you came from
    if (!anyOn && !PIVOTS.some((p) => p.match(pathname))) {
      const keep = subButtons.find((b) => b._zune.label === lastSub.get(pivot.id));
      if (keep) {
        keep.classList.add("is-active");
        keep.setAttribute("aria-current", "true");
      }
    }
  }

  /* SETTINGS | HELP and the user name */
  const linksEl = h(
    "div",
    { id: "zune-links" },
    h("button", { type: "button", text: "settings", onclick: () => settingsPage.open() }),
    h("span", { class: "zune-sep", "aria-hidden": "true", text: "|" }),
    h("button", { type: "button", text: "help", onclick: () => help.open() })
  );

  const userName = h("span", { class: "zune-user-name", text: S.Platform.initialUser?.displayName || me });
  const userMeta = h("span", { class: "zune-user-meta" });
  const userEl = h(
    "button",
    { type: "button", id: "zune-user", title: "Account", onclick: () => $('[data-testid="user-widget-link"]')?.click() },
    userName,
    userMeta
  );

  Promise.resolve()
    .then(() => S.Platform.UserAPI.getUser())
    .then((u) => {
      if (u?.displayName) userName.textContent = u.displayName;
    })
    .catch(() => {});
  let countAt = 0;
  function updateCount(force = false) {
    if (!force && Date.now() - countAt < 10000) return;
    countAt = Date.now();
    Promise.resolve()
      .then(() => S.Platform.LibraryAPI.getContents({ limit: 1 }))
      .then((r) => {
        const n = r?.unfilteredTotalLength ?? r?.totalLength;
        if (Number.isFinite(n)) userMeta.textContent = `${n.toLocaleString()} in collection`;
      })
      .catch(() => {});
  }
  updateCount(true);

  /* ------------------------------------------------------------------ */
  /* quickplay (home) goes black                                         */
  /* ------------------------------------------------------------------ */
  let booted = false;
  function updateQuickplay(pathname, instant = false) {
    const on = !isDarkScheme && settings.quickplayDark && isQuickplayPath(pathname);
    const win = on && settings.quickplayScope === "window";
    const main = on && settings.quickplayScope === "main";
    if (root.classList.contains("zune-quickplay") === win && root.classList.contains("zune-qp-main") === main) return;
    const change = () => {
      setClass("zune-quickplay", win);
      setClass("zune-qp-main", main);
    };
    if (instant) change();
    else swapPalette(change);
  }

  /* ------------------------------------------------------------------ */
  /* player bar: VOLUME readout, fillers and the now playing button      */
  /* ------------------------------------------------------------------ */
  const volLabel = h("button", { type: "button", "aria-haspopup": "dialog", "aria-controls": "zune-volume-pop", "aria-expanded": "false", title: "Scroll to change, click for a slider" });
  const volRange = h("input", { type: "range", class: "zune-range", min: "0", max: "100", step: "1", "aria-label": "Volume" });
  const muteBtn = h("button", { type: "button", text: "mute" });
  const volPop = h("div", { id: "zune-volume-pop", class: "zune-volume-pop", role: "dialog", "aria-label": "Volume" }, volRange, muteBtn);
  const volEl = h("div", { id: "zune-volume" }, volLabel);
  // Spotify isolates #main's stacking context. Keep our popup beside the
  // custom pages in body so they cannot cover the volume slider.
  document.body.append(volPop);
  const inVolume = (node) => !!node && (volEl.contains(node) || volPop.contains(node));
  const fillA = h("div", { id: "zune-fill-a", "aria-hidden": "true" });
  const fillB = h("div", { id: "zune-fill-b", "aria-hidden": "true" });

  function getVol() {
    try {
      return clamp(Number(S.Player.getVolume()) || 0, 0, 1);
    } catch (_) {
      return 0;
    }
  }
  function getMuted() {
    try {
      return !!S.Player.getMute?.();
    } catch (_) {
      return false;
    }
  }

  let lastVolume = "";
  function renderVolume(force = false) {
    const pct = Math.round(getVol() * 100);
    const muted = getMuted() || pct === 0;
    const stamp = `${pct}|${muted}`;
    if (!force && stamp === lastVolume) return;
    lastVolume = stamp;
    volLabel.textContent = muted ? "MUTED" : `VOLUME ${pct}`;
    volEl.classList.toggle("is-muted", muted);
    if (document.activeElement !== volRange) volRange.value = String(pct);
    volRange.style.setProperty("--zune-fill", `${volRange.value}%`);
    muteBtn.textContent = muted ? "unmute" : "mute";
  }
  function setVol(v) {
    try {
      S.Player.setVolume(clamp(v, 0, 1));
    } catch (_) {
      /* player busy */
    }
    setTimeout(() => renderVolume(true), 60);
  }

  // Wheel: one step per mouse notch, trackpads accumulate; at most one
  // setVolume per frame. Horizontal swipes are ignored.
  let wheelAcc = 0;
  let wheelLast = 0;
  let wheelSteps = 0;
  let wheelFrame = 0;
  volEl.addEventListener(
    "wheel",
    (e) => {
      if (!settings.wheelVolume) return;
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? window.innerHeight : 1;
      const dy = e.deltaY * unit;
      const dx = e.deltaX * unit;
      if (Math.abs(dy) < 1 || Math.abs(dx) > Math.abs(dy)) return;
      e.preventDefault();
      if (e.timeStamp - wheelLast > 300) wheelAcc = 0; // a new gesture
      wheelLast = e.timeStamp;
      if (Math.abs(dy) >= 50) {
        wheelAcc = 0;
        wheelSteps += Math.sign(dy);
      } else {
        wheelAcc += dy;
        while (Math.abs(wheelAcc) >= 40) {
          wheelSteps += Math.sign(wheelAcc);
          wheelAcc -= 40 * Math.sign(wheelAcc);
        }
      }
      if (wheelFrame || !wheelSteps) return;
      wheelFrame = requestAnimationFrame(() => {
        wheelFrame = 0;
        const steps = wheelSteps;
        wheelSteps = 0;
        if (steps) setVol(getVol() - (steps * settings.volumeStep) / 100);
      });
    },
    { passive: false }
  );

  function positionVolPop() {
    if (!volEl.classList.contains("is-open")) return;
    const anchor = volEl.getBoundingClientRect();
    const width = volPop.getBoundingClientRect().width;
    volPop.style.left = `${clamp(anchor.left + anchor.width / 2 - width / 2, 8, Math.max(8, window.innerWidth - width - 8))}px`;
    volPop.style.bottom = `${window.innerHeight - anchor.top + 42}px`;
  }
  function setVolPop(open) {
    volEl.classList.toggle("is-open", open);
    volPop.classList.toggle("is-open", open);
    volLabel.setAttribute("aria-expanded", String(open));
    if (open) {
      renderVolume(true);
      positionVolPop();
      requestAnimationFrame(() => volRange.focus({ preventScroll: true }));
    }
  }
  volLabel.addEventListener("click", () => setVolPop(!volEl.classList.contains("is-open")));
  volRange.addEventListener("blur", () => renderVolume(true));
  for (const node of [volEl, volPop]) node.addEventListener("focusout", (e) => {
    if (volEl.classList.contains("is-open") && !inVolume(e.relatedTarget)) setVolPop(false);
  });
  window.addEventListener("resize", positionVolPop);
  volRange.addEventListener("input", () => {
    volRange.style.setProperty("--zune-fill", `${volRange.value}%`);
    setVol(Number(volRange.value) / 100);
  });
  muteBtn.addEventListener("click", () => {
    try {
      // Older Spicetify wrappers look for a mute-button class Spotify no
      // longer renders. The native control preserves Spotify's unmute level.
      const nativeMute = $('aside[data-testid="now-playing-bar"] [data-testid="volume-bar-toggle-mute-button"]');
      if (nativeMute && !nativeMute.disabled) nativeMute.click();
      else S.Player.toggleMute?.();
    } catch (_) {
      /* ignore */
    }
    setTimeout(() => renderVolume(true), 80);
  });
  document.addEventListener("pointerdown", (e) => {
    if (volEl.classList.contains("is-open") && !inVolume(e.target)) setVolPop(false);
  });

  const npButton = h(
    "button",
    { type: "button", id: "zune-np-button", title: "Now playing", "aria-label": "Now playing", onclick: () => mix.open() },
    h("i"),
    h("i"),
    h("i"),
    h("i")
  );

  // Optional: the album art in the bar opens the mix view instead of
  // Spotify's panel. A capture listener on document runs before React's.
  document.addEventListener(
    "click",
    (e) => {
      if (!settings.coverOpensMixView) return;
      const btn = e.target?.closest?.('aside[data-testid="now-playing-bar"] [data-testid="cover-art-button"]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      mix.open();
    },
    true
  );

  function updatePlaying() {
    let playing = false;
    try {
      playing = !!S.Player.isPlaying?.();
    } catch (_) {
      // A temporary player disconnect must not abort theme initialization.
    }
    root.classList.toggle("zune-playing", playing);
  }

  /* ------------------------------------------------------------------ */
  /* overlays: inert page, focus trap, Escape                            */
  /* ------------------------------------------------------------------ */
  const overlays = []; // stack, top last
  // set by the menu module: the menu key, Shift+F10 and Enter on a name link,
  // handled before any overlay's key shield
  let surfaceKey = null;

  // Input activity, for "open now playing when idle". Returns true when it
  // closed a mix view that had opened by itself.
  let lastInput = Date.now();
  let lastPointer = null;
  let idleOpened = false;
  function noteActivity(e) {
    if (e.type === "pointermove") {
      // ignore sub-pixel jitter from trackpads and mice resting on a desk
      const p = [e.screenX, e.screenY];
      const moved = !lastPointer || Math.abs(p[0] - lastPointer[0]) + Math.abs(p[1] - lastPointer[1]) > 6;
      if (!moved) return false;
      lastPointer = p;
    }
    lastInput = Date.now();
    const close = idleOpened && settings.idleCloseOnActivity && mix.isOpen;
    idleOpened = false;
    if (close) mix.close();
    return close;
  }

  function syncInert() {
    const r = $(".Root");
    if (r) r.inert = overlays.length > 0;
    for (const id of ["zune-browser", "zune-qp", "zune-social", "zune-browse"]) {
      const node = document.getElementById(id);
      if (node) node.inert = overlays.length > 0;
    }
    overlays.forEach((o, i) => {
      o.el.inert = i < overlays.length - 1;
    });
  }
  // Zoone's pages (collection, quickplay, social, browse) sit over Spotify's
  // main view, or over the whole row when they fill the window. Spotify's
  // resize handles on the main view's edges stay uncovered when they don't.
  function placeOver(el, full) {
    const mv = document.getElementById("main-view");
    if (!mv) return;
    const r = mv.getBoundingClientRect();
    const GAP = 8;
    el.style.top = `${Math.round(r.top)}px`;
    el.style.height = `${Math.round(r.height)}px`;
    el.style.left = full ? "0px" : `${Math.round(r.left + GAP)}px`;
    el.style.width = full ? "100vw" : `${Math.round(r.width - GAP * 2)}px`;
  }
  // What a page covers takes no focus or clicks. Each page says what it
  // covers; a pane wakes only when no page covers it any more.
  const coverOwners = new Map();
  const coveredNow = new Set();
  function coverPanes(owner, on, full) {
    const want = new Set();
    if (on) {
      const add = (n) => n && want.add(n);
      add(document.getElementById("main-view"));
      if (full) {
        add(document.getElementById("Desktop_LeftSidebar_Id"));
        add($('[data-zune="right-cell"]'));
      }
    }
    if (want.size) coverOwners.set(owner, want);
    else coverOwners.delete(owner);
    const all = new Set();
    for (const set of coverOwners.values()) for (const n of set) all.add(n);
    for (const n of coveredNow) if (!all.has(n)) n.inert = false;
    for (const n of all) n.inert = true;
    coveredNow.clear();
    all.forEach((n) => coveredNow.add(n));
  }
  function pushOverlay(o) {
    setVolPop(false);
    if (!overlays.includes(o)) overlays.push(o);
    syncInert();
  }
  function popOverlay(o) {
    o.el.inert = false;
    const i = overlays.indexOf(o);
    if (i >= 0) overlays.splice(i, 1);
    syncInert();
  }

  function focusables(container) {
    return [...container.querySelectorAll('button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])')].filter(
      (n) => !n.disabled && n.offsetParent !== null
    );
  }

  // Capture on window so the theme's overlays get keys before Spotify's
  // shortcuts. Default actions (typing, button activation) still happen.
  function shield(e) {
    const top = overlays[overlays.length - 1];
    if (top && top.el.contains(e.target)) e.stopImmediatePropagation();
  }
  window.addEventListener(
    "keydown",
    (e) => {
      // A key closes a mix view that opened by itself, if set to; the key
      // is then consumed so it can't trigger anything underneath.
      if (noteActivity(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (surfaceKey?.(e)) return;
      const top = overlays[overlays.length - 1];
      if (!top) {
        if (e.key === "Escape" && volEl.classList.contains("is-open")) {
          e.preventDefault();
          e.stopImmediatePropagation();
          setVolPop(false);
          volLabel.focus({ preventScroll: true });
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        // an overlay with levels (the menu and its playlist list) closes one
        if (!top.escape?.()) top.close();
        return;
      }
      if (e.key === "Tab" && !top.ownTab) {
        const items = focusables(top.el);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        const inside = top.el.contains(document.activeElement);
        if (!inside || (e.shiftKey && document.activeElement === first)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
      top.onKey?.(e);
      shield(e);
    },
    true
  );
  window.addEventListener("keyup", shield, true);
  window.addEventListener("keypress", shield, true);

  /* ------------------------------------------------------------------ */
  /* mix view: full-window now playing                                   */
  /* ------------------------------------------------------------------ */
  const mix = (() => {
    const MAX_TILES = 260;
    const el = h("div", { id: "zune-mixview", role: "dialog", "aria-modal": "true", "aria-label": "Now playing", tabindex: "-1" });
    const mosaic = h("div", { class: "zmv-mosaic", "aria-hidden": "true" });
    const hero = h("div", { class: "zmv-hero", "aria-hidden": "true" }, h("img", { alt: "" }), h("img", { alt: "" }));
    const tint = h("div", { class: "zmv-tint" });
    const shade = h("div", { class: "zmv-shade" });
    const dragbar = h("div", { class: "zmv-dragbar" });
    const back = h("button", { type: "button", class: "zmv-back", "aria-label": "Close now playing", html: ICON.back, onclick: () => close() });
    const label = h("div", { class: "zmv-label", text: "now playing" });

    const cover = h("img", { class: "zmv-cover", alt: "" });
    const artist = h("div", { class: "zmv-artist" });
    const album = h("div", { class: "zmv-album" });
    const title = h("div", { class: "zmv-title" });
    const heart = h("button", {
      type: "button",
      class: "zmv-heart",
      "aria-label": "Like",
      "aria-pressed": "false",
      html: ICON.heart,
      onclick: () => {
        try {
          S.Player.toggleHeart?.();
        } catch (_) {
          /* ignore */
        }
        setTimeout(renderHeart, 150);
        setTimeout(renderHeart, 900);
      },
    });
    const info = h("div", { class: "zmv-info" }, cover, h("div", { class: "zmv-text" }, artist, album, title, heart));

    const queueList = h("ol");
    const queue = h("div", { class: "zmv-queue", "aria-label": "Up next" }, h("h3", { text: "up next" }), queueList);

    const cur = h("span", { text: "0:00" });
    const dur = h("span", { text: "0:00" });
    const seekTo = (ms) => {
      const d = S.Player.getDuration?.() || 0;
      if (!d) return;
      try {
        S.Player.seek(Math.round(clamp(ms, 0, d - 500)));
      } catch (_) {
        /* ignore */
      }
      setTimeout(renderProgress, 120);
    };
    const line = h("div", {
      class: "zmv-line",
      role: "slider",
      tabindex: "0",
      "aria-label": "Seek",
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      onclick: (e) => {
        const r = line.getBoundingClientRect();
        seekTo(clamp((e.clientX - r.left) / r.width, 0, 1) * (S.Player.getDuration?.() || 0));
      },
    });
    line.append(h("i"));
    const playBtn = h("button", { type: "button", class: "zmv-play", "aria-label": "Play", html: ICON.play, onclick: () => S.Player.togglePlay() });
    const bottom = h(
      "div",
      { class: "zmv-bottom" },
      h("div", { class: "zmv-progress" }, cur, line, dur),
      h(
        "div",
        { class: "zmv-transport" },
        h("button", { type: "button", "aria-label": "Previous", html: ICON.prev, onclick: () => S.Player.back() }),
        playBtn,
        h("button", { type: "button", "aria-label": "Next", html: ICON.next, onclick: () => S.Player.next() })
      )
    );

    el.append(mosaic, hero, tint, shade, dragbar, back, label, info, queue, bottom);
    document.body.append(el);

    let isOpen = false;
    let lastFocus = null;
    let libraryArt = [];
    let libraryAt = 0;
    let libraryPromise = null;
    const artistCache = new Map();
    let pool = [];
    let related = [];
    let photos = [];
    let photoIdx = 0;
    let flipTimer = 0;
    let photoTimer = 0;
    let refreshSeq = 0;
    let lastTrackUri = "";
    let lastArtistUri = "";
    let lastTintSrc = "";
    let lastLarge = null;
    let tintToken = 0;
    let queueTimer = 0;
    let lastQueueRev = null;

    const fmt = (ms) => {
      const s = Math.max(0, Math.floor((ms || 0) / 1000));
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    };

    function loadLibraryArt() {
      if (libraryArt.length && Date.now() - libraryAt < 10 * 60 * 1000) return Promise.resolve(libraryArt);
      if (!libraryPromise) {
        libraryPromise = Promise.resolve()
          .then(() => S.Platform.LibraryAPI.getContents({ filters: ["0"], limit: 150, offset: 0 })) // "0" is the Albums filter
          .then((res) => {
            libraryArt = (res?.items || []).map((i) => imageUrl(i?.images?.[0]?.url)).filter(Boolean);
            libraryAt = Date.now();
            return libraryArt;
          })
          .catch(() => libraryArt)
          .finally(() => {
            libraryPromise = null;
          });
      }
      return libraryPromise;
    }

    async function loadArtist(uri) {
      if (!uri) return { photos: [], related: [] };
      const cached = artistCache.get(uri);
      if (cached && (!cached.failedAt || Date.now() - cached.failedAt < 60000)) return cached;
      let result = { photos: [], related: [], failedAt: Date.now() };
      try {
        const def = S.GraphQL?.Definitions?.queryArtistOverview;
        if (def) {
          const res = await S.GraphQL.Request(def, { uri, locale: "", includePrerelease: false });
          const a = res?.data?.artistUnion;
          const best = (sources) => (sources || []).slice().sort((x, y) => (y.width || 0) - (x.width || 0))[0]?.url;
          const gallery = (a?.visuals?.gallery?.items || []).map((g) => best(g.sources));
          if (!a) throw new Error("no artist data");
          result = {
            photos: [best(a?.visuals?.headerImage?.sources), ...gallery, best(a?.visuals?.avatarImage?.sources)].filter(Boolean),
            related: (a?.relatedContent?.relatedArtists?.items || []).map((r) => best(r?.visuals?.avatarImage?.sources)).filter(Boolean),
          };
        }
      } catch (_) {
        /* no artist info */
      }
      artistCache.set(uri, result);
      if (artistCache.size > 20) artistCache.delete(artistCache.keys().next().value);
      return result;
    }

    function queueTracks() {
      const q = S.Queue || {};
      const meta = (t) => t?.contextTrack?.metadata || t?.metadata || {};
      const real = (t) => {
        const uri = t?.contextTrack?.uri || t?.uri || "";
        return uri && !uri.includes("delimiter");
      };
      return {
        prev: (q.prevTracks || []).filter(real).map(meta),
        next: (q.nextTracks || []).filter(real).map((t) => ({ ...meta(t), uri: t?.contextTrack?.uri || t?.uri || "", uid: t?.contextTrack?.uid || t?.uid || "", provider: t?.provider || "" })),
      };
    }

    function computePool(current) {
      const parts = [current];
      if (settings.sourceQueue) {
        const { prev, next } = queueTracks();
        parts.push(...[...prev, ...next].map((t) => imageUrl(t.image_url || t.image_large_url)));
      }
      if (settings.sourceRelated) parts.push(...related);
      if (settings.sourceLibrary) parts.push(...shuffle(libraryArt).slice(0, 90));
      pool = [...new Set(parts.filter(Boolean))];
    }

    function tileCount() {
      const size = Number(settings.tileSize) || 118;
      return Math.min(MAX_TILES, Math.ceil(window.innerWidth / size) * Math.ceil(window.innerHeight / size) + 6);
    }

    function pick() {
      return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    }

    function tileImage(src, cls) {
      const img = h("img", { src, alt: "", decoding: "async", class: cls || null });
      img.onerror = () => img.remove();
      if (cls === "is-in") {
        // the entry class carries will-change, a compositor layer per image;
        // drop it after the 0.9 s flip so only flipping tiles have layers
        const settle = () => img.classList.remove("is-in");
        img.addEventListener("animationend", settle, { once: true });
        setTimeout(settle, 1500);
      }
      return img;
    }

    function buildMosaic() {
      const n = tileCount();
      const frag = document.createDocumentFragment();
      for (let i = 0; i < n; i++) {
        const tile = h("div", { class: `zmv-tile${Math.random() < 0.09 ? " is-big" : ""}`, style: `--i:${Math.min(i, 60)}` });
        const src = pick();
        if (src) tile.append(tileImage(src));
        frag.append(tile);
      }
      mosaic.replaceChildren(frag);
    }

    function fillEmptyTiles() {
      for (const tile of mosaic.children) {
        if (!tile.querySelector("img")) {
          const src = pick();
          if (src) tile.append(tileImage(src, "is-in"));
        }
      }
    }

    function flipOne() {
      if (!isOpen || document.hidden || pool.length < 2) return;
      const tiles = mosaic.children;
      if (!tiles.length) return;
      const tile = tiles[Math.floor(Math.random() * tiles.length)];
      if (tile.dataset.flipping || tile.querySelectorAll("img").length > 1) return;
      const old = tile.querySelector("img");
      const src = pick();
      if (!src || old?.getAttribute("src") === src) return;
      tile.dataset.flipping = "1";
      const pre = new Image();
      pre.onload = () => {
        delete tile.dataset.flipping;
        if (!isOpen || !tile.isConnected || tile.querySelectorAll("img").length > 1) return;
        tile.append(tileImage(src, "is-in"));
        if (old) {
          old.classList.add("is-out");
          setTimeout(() => old.remove(), 950);
        }
      };
      pre.onerror = () => delete tile.dataset.flipping;
      pre.src = src;
    }

    function showPhoto() {
      const [a, b] = hero.children;
      if (!settings.showArtistPhoto || !photos.length) {
        a.classList.remove("is-on");
        b.classList.remove("is-on");
        return;
      }
      const src = photos[photoIdx % photos.length];
      photoIdx++;
      const front = a.classList.contains("is-on") ? b : a;
      const backImg = front === a ? b : a;
      front.onload = () => {
        front.classList.add("is-on");
        backImg.classList.remove("is-on");
      };
      front.onerror = () => {
        photos = photos.filter((p) => p !== src);
      };
      front.src = src;
    }

    function stopTimers() {
      clearInterval(flipTimer);
      clearInterval(photoTimer);
      clearInterval(queueTimer);
      flipTimer = 0;
      photoTimer = 0;
      queueTimer = 0;
    }
    function restartTimers() {
      stopTimers();
      if (!isOpen) return;
      lastQueueRev = S.Queue?.queueRevision ?? null;
      queueTimer = setInterval(() => {
        const rev = S.Queue?.queueRevision ?? null;
        if (rev === lastQueueRev) return;
        lastQueueRev = rev;
        renderQueue(S.Player.data?.item?.metadata || {});
        computePool(lastLarge);
      }, 3000);
      if (settings.motion === "off") return;
      if (settings.mosaicFlip) flipTimer = setInterval(flipOne, Math.round(settings.flipInterval * 1000));
      if (settings.showArtistPhoto && photos.length > 1) photoTimer = setInterval(showPhoto, Math.round(settings.photoInterval * 1000));
    }

    function applyTint(src) {
      if (src !== undefined) lastTintSrc = src || "";
      const token = ++tintToken;
      const mode = settings.tint;
      if (mode === "none") return el.style.setProperty("--zmv-tint", "transparent");
      if (mode === "accent") return el.style.setProperty("--zmv-tint", "var(--zune-accent)");
      if (mode === "custom") return el.style.setProperty("--zmv-tint", settings.tintColor);
      const from = lastTintSrc;
      if (!from) return el.style.removeProperty("--zmv-tint");
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        if (token !== tintToken) return;
        try {
          const c = document.createElement("canvas");
          c.width = c.height = 16;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, 16, 16);
          const d = ctx.getImageData(0, 0, 16, 16).data;
          let r = 0;
          let g = 0;
          let b = 0;
          let wsum = 0;
          for (let i = 0; i < d.length; i += 4) {
            const w = 1 + (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2])) / 32; // favour saturated pixels
            r += d[i] * w;
            g += d[i + 1] * w;
            b += d[i + 2] * w;
            wsum += w;
          }
          const [hue, sat] = rgbToHsl(r / wsum, g / wsum, b / wsum);
          const s = clamp(sat * 1.3, 0.3, 0.75);
          el.style.setProperty("--zmv-tint", `hsl(${Math.round(hue * 360)} ${Math.round(s * 100)}% 52%)`);
        } catch (_) {
          el.style.removeProperty("--zmv-tint");
        }
      };
      img.onerror = () => {
        if (token === tintToken) el.style.removeProperty("--zmv-tint");
      };
      img.src = from;
    }

    function renderHeart() {
      const on = !!S.Player.getHeart?.();
      heart.classList.toggle("is-on", on);
      heart.setAttribute("aria-pressed", String(on));
    }

    function renderPlay() {
      const playing = !!S.Player.isPlaying?.();
      playBtn.innerHTML = playing ? ICON.pause : ICON.play;
      playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
    }

    // Spotify reports progress many times a second; the line moves a pixel
    // every few hundred ms, so routine updates come at most four times a
    // second (opening and seeking update at once)
    let progressAt = 0;
    function renderProgress(force = false) {
      if (!isOpen) return;
      const t = performance.now();
      if (force !== true && t - progressAt < 250) return;
      progressAt = t;
      const p = S.Player.getProgress?.() || 0;
      const d = S.Player.getDuration?.() || 0;
      const pct = d ? (p / d) * 100 : 0;
      const now = fmt(p);
      const total = fmt(d);
      if (cur.textContent !== now) cur.textContent = now;
      if (dur.textContent !== total) dur.textContent = total;
      const width = `${pct.toFixed(1)}%`;
      if (line._w !== width) {
        line._w = width;
        // a transform moves the fill without a layout
        line.style.setProperty("--zmv-progress", width);
        line.style.setProperty("--zmv-scale", (pct / 100).toFixed(4));
      }
      const valueNow = String(Math.round(pct));
      if (line.getAttribute("aria-valuenow") !== valueNow) line.setAttribute("aria-valuenow", valueNow);
      const valueText = `${now} of ${total}`;
      if (line.getAttribute("aria-valuetext") !== valueText) line.setAttribute("aria-valuetext", valueText);
    }

    function renderQueue(currentMeta) {
      const { next } = queueTracks();
      const items = [h("li", { class: "is-current" }, currentMeta.title || "", h("small", { text: currentMeta.artist_name || "" }))];
      next.slice(0, settings.queueLength).forEach((m, i) => {
        // Focusable, so the keys and the menu reach each song. Double-click
        // or Enter plays from it; songs the user queued can be removed.
        const queued = m.provider === "queue" && !!m.uid;
        const li = h(
          "li",
          {
            tabindex: m.uri ? "0" : null,
            class: queued ? "is-queued" : null,
            title: queued ? "Double-click to play from here. Delete removes it." : "Double-click to play from here.",
            "data-uri": m.uri || "",
            "data-uid": m.uid || null,
            "data-provider": m.provider || null,
            "data-name": m.title || "",
            "data-album": m.album_uri || "",
            "data-artist": m.artist_uri || "",
            ondblclick: (e) => !e.target.closest(".zmv-qx") && skipToQueued(li),
          },
          m.title || "",
          h("small", { text: m.artist_name || "" }),
          queued ? h("button", { type: "button", class: "zmv-qx", tabindex: "-1", "aria-label": `Remove ${m.title || "this song"} from up next`, text: "×", onclick: () => removeQueued(li) }) : null
        );
        li.style.animationDelay = `${0.04 * (i + 1)}s`;
        items.push(li);
      });
      queueList.replaceChildren(...items);
    }

    // play from a song in Up next: Spotify's skipTo takes its own entry
    async function skipToQueued(li) {
      const { uri, uid } = li.dataset;
      if (!uri) return;
      const entry = S.Platform.PlayerAPI.getState?.()?.nextItems?.find((x) => (uid ? x.uid === uid : x.uri === uri)) || { uri, uid };
      try {
        await S.Platform.PlayerAPI.skipTo(entry);
      } catch (_) {
        notify("Zoone: Spotify couldn't skip there", true);
      }
    }
    // take a song the user queued back out; focus moves to its neighbour
    async function removeQueued(li) {
      const { uri, uid } = li.dataset;
      if (!uid || li.dataset.provider !== "queue") return;
      const had = li.contains(document.activeElement) || document.activeElement === li;
      const next = li.nextElementSibling || li.previousElementSibling;
      li.remove();
      if (had && next?.matches?.("li[tabindex]")) next.focus({ preventScroll: true });
      try {
        await S.Platform.PlayerAPI.removeFromQueue([{ uri, uid }]);
      } catch (_) {
        notify("Zoone: Spotify couldn't change the queue", true);
      }
      setTimeout(() => isOpen && renderQueue(S.Player.data?.item?.metadata || {}), 400);
    }

    async function refresh(force = false) {
      const item = S.Player.data?.item;
      const seq = ++refreshSeq;
      if (!item) {
        fillLinks(artist, []);
        fillLinks(album, []);
        title.textContent = "";
        cover.removeAttribute("src");
        cover.style.visibility = "hidden";
        queueList.replaceChildren();
        return;
      }
      const m = item.metadata || {};
      const trackUri = item.uri || "";
      const large = imageUrl(m.image_xlarge_url || m.image_large_url || m.image_url);
      lastLarge = large;

      // the names open their pages (each artist its own link); right-click
      // or the menu key gives their menus
      const artists = item.artists?.length ? item.artists.map((a) => ({ uri: a.uri, name: a.name })) : [{ uri: m.artist_uri, name: m.artist_name }];
      fillLinks(artist, artists, true);
      const albumUri = item.album?.uri || m.album_uri;
      fillLinks(album, [{ uri: albumUri, name: m.album_title, artist: item.artists?.[0]?.uri }], true);
      title.textContent = m.title || "";
      title.setAttribute("tabindex", "0");
      title.setAttribute("data-uri", item.uri || "");
      title.setAttribute("data-name", m.title || "");
      title.setAttribute("data-album", item.album?.uri || "");
      title.setAttribute("data-artist", item.artists?.[0]?.uri || "");
      if (large) cover.src = large;
      else cover.removeAttribute("src");
      cover.style.visibility = large ? "" : "hidden";
      cover.alt = m.album_title || "";
      renderHeart();
      renderPlay();
      renderProgress(true);
      renderQueue(m);

      if (!force && trackUri === lastTrackUri) return;
      lastTrackUri = trackUri;
      applyTint(imageUrl(m.image_url || m.image_large_url) || "");

      // Build straight away from what is cached, then refine.
      computePool(large);
      if (!mosaic.children.length || force) buildMosaic();

      const artistUri = m.artist_uri || "";
      const needArtist = force || artistUri !== lastArtistUri;
      const [, info] = await Promise.all([
        settings.sourceLibrary ? loadLibraryArt() : null,
        needArtist ? loadArtist(artistUri) : null,
      ]);
      if (seq !== refreshSeq || !isOpen) return;

      if (info) {
        lastArtistUri = artistUri;
        related = info.related;
        photos = info.photos.length ? info.photos : large ? [large] : [];
        photoIdx = 0;
        showPhoto();
      }
      const before = pool.length;
      computePool(large);
      if (before < 8 && pool.length >= 8) buildMosaic();
      else fillEmptyTiles();
      restartTimers();
    }

    const overlay = {
      el,
      close: () => close(),
      onKey: (e) => {
        // Up next: the arrow keys move, Enter plays from there, Delete removes
        const li = e.target.closest?.(".zmv-queue li[data-uri]");
        if (li && !e.metaKey && !e.ctrlKey && !e.altKey) {
          const items = [...queueList.querySelectorAll("li[data-uri][tabindex]")];
          const i = items.indexOf(li);
          if (e.key === "Enter" && e.target === li) {
            e.preventDefault();
            if (!e.repeat) skipToQueued(li);
            return true;
          }
          if ((e.key === "Delete" || e.key === "Backspace") && li.dataset.provider === "queue") {
            e.preventDefault();
            removeQueued(li);
            return true;
          }
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            items[Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
            return true;
          }
        }
        if (e.target !== line) return false;
        const p = S.Player.getProgress?.() || 0;
        const step = e.shiftKey ? 30000 : 5000;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") seekTo(p + step);
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") seekTo(p - step);
        else if (e.key === "Home") seekTo(0);
        else if (e.key === "End") seekTo(S.Player.getDuration?.() || 0);
        else return false;
        e.preventDefault();
        return true;
      },
    };

    function open() {
      if (isOpen) return;
      isOpen = true;
      lastFocus = document.activeElement;
      el.classList.add("is-open");
      pushOverlay(overlay);
      refresh(true);
      restartTimers();
      requestAnimationFrame(() => back.focus({ preventScroll: true }));
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      refreshSeq++;
      el.classList.remove("is-open");
      stopTimers();
      popOverlay(overlay);
      if (lastFocus?.isConnected) lastFocus.focus?.({ preventScroll: true });
      lastFocus = null;
    }

    const rebuildSoon = debounce(() => isOpen && buildMosaic(), 250);
    window.addEventListener("resize", () => isOpen && rebuildSoon());
    // A hidden window paints nothing: stop the flip and photo timers until it is back
    document.addEventListener("visibilitychange", () => {
      if (!isOpen) return;
      if (document.hidden) stopTimers();
      else {
        restartTimers();
        renderProgress(true);
      }
    });

    function onSettings(key) {
      if (!isOpen) return;
      if (key === "*" || key === "tileSize") rebuildSoon();
      if (key === "*" || key === "tint" || key === "tintColor" || key === "accent") applyTint();
      if (key === "*" || key === "queueLength" || key === "sourceQueue") renderQueue(S.Player.data?.item?.metadata || {});
      if (key === "*" || key.startsWith("source")) {
        computePool(lastLarge);
        if (key !== "*") rebuildSoon();
      }
      if (key === "showArtistPhoto") showPhoto();
      if (["*", "mosaicFlip", "flipInterval", "photoInterval", "motion", "showArtistPhoto"].includes(key)) restartTimers();
    }

    return {
      open,
      close,
      get isOpen() {
        return isOpen;
      },
      preload: () => settings.sourceLibrary && loadLibraryArt(),
      onSongChange: () => isOpen && refresh(false),
      onPlayPause: () => isOpen && renderPlay(),
      onProgress: renderProgress,
      onSettings,
    };
  })();

  /* ------------------------------------------------------------------ */
  /* settings page                                                       */
  /* ------------------------------------------------------------------ */
  const settingsPage = (() => {
    const el = h("div", { id: "zune-settings", role: "dialog", "aria-modal": "true", "aria-labelledby": "zs-title", tabindex: "-1" });
    const back = h("button", { type: "button", class: "zs-back", "aria-label": "Close settings", html: ICON.back, onclick: () => close() });
    const head = h("div", { class: "zs-head" }, back, h("h1", { class: "zs-title", id: "zs-title", text: "settings" }));
    const tabs = h(
      "div",
      { class: "zs-tabs" },
      h("button", { type: "button", class: "is-active", "aria-current": "page", text: "theme" }),
      h("button", {
        type: "button",
        text: "spotify",
        onclick: () => {
          close();
          History.push("/preferences");
        },
      })
    );
    const cats = h("div", { class: "zs-cats", role: "tablist", "aria-orientation": "vertical", "aria-label": "Settings categories" });
    const pane = h("div", { class: "zs-pane", id: "zs-pane", role: "tabpanel", tabindex: "0" });
    el.append(head, tabs, h("div", { class: "zs-body" }, cats, pane));
    document.body.append(el);

    let isOpen = false;
    let currentCat = "colors";
    let lastFocus = null;
    const rows = new Map();
    const overlay = { el, close: () => close() };

    const catButtons = CATEGORIES.map((c) =>
      h("button", {
        type: "button",
        role: "tab",
        id: `zs-tab-${c.id}`,
        "aria-controls": "zs-pane",
        "aria-selected": "false",
        text: c.label,
        onclick: () => show(c.id),
      })
    );
    cats.append(...catButtons);

    const decimals = (step) => (String(step).split(".")[1] || "").length;
    const roundTo = (v, step) => Number((Math.round(v / step) * step).toFixed(decimals(step)));
    function fmtValue(def, v) {
      if (def.fmt === "pct") return `${(v * 100).toFixed(decimals(Number((def.step * 100).toFixed(6))))}%`;
      return `${Number(v).toFixed(decimals(def.step))}${def.unit ?? ""}`;
    }
    const isChanged = (def) => (def.scheme ? !!colorOverrides[def.key] : settings[def.key] !== DEFAULTS[def.key]);

    function buildRow(def) {
      const labelId = `zs-l-${def.key}`;
      const errId = `zs-e-${def.key}`;
      const err = h("span", { class: "zs-help zs-err", id: errId, role: "alert" });
      const status = h("span", { class: "zs-status", role: "status" });
      const label = h("div", { class: "zs-label", id: labelId }, def.label, def.help ? h("span", { class: "zs-help", text: def.help }) : null, err, status);
      const control = h("div", { class: "zs-control" });
      let field = null;
      const setError = (msg) => {
        err.textContent = msg || "";
        row.classList.toggle("has-error", !!msg);
        if (field) {
          if (msg) field.setAttribute("aria-invalid", "true");
          else field.removeAttribute("aria-invalid");
        }
      };
      const reset = h("button", {
        type: "button",
        class: "zs-reset",
        text: def.scheme ? "scheme" : "default",
        "aria-label": `Reset ${def.label}`,
        onclick: () => {
          setError("");
          status.textContent = "";
          resetKey(def.key);
          refreshRow(def.key);
        },
      });
      const row = h("div", { class: `zs-row${def.stacked ? " is-stacked" : ""}`, "data-key": def.key }, label, control);
      let update = () => {};

      if (def.kind === "toggle") {
        const state = h("span", { class: "zs-state" });
        const sw = h("button", { type: "button", class: "zs-switch", role: "switch", "aria-labelledby": labelId }, state, h("span", { class: "zs-track", "aria-hidden": "true" }));
        sw.addEventListener("click", () => {
          setValue(def.key, !settings[def.key]);
          refreshRow(def.key);
        });
        update = () => {
          const on = !!settings[def.key];
          sw.setAttribute("aria-checked", String(on));
          state.textContent = on ? "on" : "off";
        };
        control.append(sw);
      } else if (def.kind === "range") {
        const out = h("span", { class: "zs-range-value", "aria-hidden": "true" });
        const input = h("input", { type: "range", class: "zune-range", min: String(def.min), max: String(def.max), step: String(def.step), "aria-labelledby": labelId });
        input.addEventListener("input", () => {
          setValue(def.key, roundTo(Number(input.value), def.step));
          refreshRow(def.key);
        });
        update = () => {
          const v = settings[def.key];
          if (document.activeElement !== input) input.value = String(v);
          out.textContent = fmtValue(def, v);
          input.setAttribute("aria-valuetext", fmtValue(def, v));
          input.style.setProperty("--zune-fill", `${((v - def.min) / (def.max - def.min)) * 100}%`);
        };
        control.append(out, input);
      } else if (def.kind === "choice") {
        const group = h("div", { class: "zs-seg", role: "radiogroup", "aria-labelledby": labelId });
        const btns = def.options.map(([value, text]) => {
          const b = h("button", { type: "button", role: "radio", text });
          b.addEventListener("click", () => {
            setValue(def.key, value);
            refreshRow(def.key);
          });
          b._value = value;
          return b;
        });
        group.append(...btns);
        update = () =>
          btns.forEach((b) => {
            const on = b._value === settings[def.key];
            b.setAttribute("aria-checked", String(on));
            b.tabIndex = on ? 0 : -1;
          });
        control.append(group);
      } else if (def.kind === "text") {
        const input = h("input", { type: "text", "aria-labelledby": labelId, "aria-describedby": errId, placeholder: def.placeholder || "", spellcheck: "false", autocomplete: "off" });
        field = input;
        const commit = () => {
          const v = input.value.trim();
          const problem = validateValue(def, v);
          setError(problem);
          if (problem) return;
          setValue(def.key, v);
          refreshRow(def.key);
          if (def.key === "wallpaper") checkWallpaper(v, status, setError);
        };
        input.addEventListener("change", commit);
        if (def.live) input.addEventListener("input", debounce(commit, 180));
        update = () => {
          if (document.activeElement !== input) {
            input.value = settings[def.key] ?? "";
            if (!validateValue(def, input.value)) setError("");
          }
        };
        control.append(input);
      } else if (def.kind === "color") {
        const value = () => (def.scheme ? colorOverrides[def.key] || schemeValue(def) : settings[def.key]);
        const apply = (hex) => {
          if (def.scheme) setSchemeColor(def.key, hex);
          else setValue(def.key, normHex(hex) || DEFAULTS[def.key]);
          refreshRow(def.key);
        };
        const picker = h("input", { type: "color", "aria-label": `${def.label} colour picker` });
        const swatch = h("label", { class: "zs-swatch" }, picker);
        const hex = h("input", { type: "text", class: "zs-hex", "aria-label": `${def.label} hex value`, spellcheck: "false", maxlength: "7", autocomplete: "off" });
        picker.addEventListener("input", () => apply(picker.value));
        hex.addEventListener("change", () => {
          const n = normHex(hex.value);
          if (n) apply(n);
          else hex.value = value();
        });
        let palette = null;
        if (def.palette) {
          palette = h("div", { class: "zs-palette", role: "group", "aria-label": "Metro accent colours" });
          for (const [name, c] of METRO) {
            const b = h("button", { type: "button", "aria-label": name, title: name, style: `background:${c}` });
            b._value = c;
            b.addEventListener("click", () => apply(c));
            palette.append(b);
          }
        }
        update = () => {
          const v = value();
          swatch.style.background = v;
          if (document.activeElement !== picker) picker.value = v;
          if (document.activeElement !== hex) hex.value = v;
          palette?.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b._value === v)));
        };
        if (palette) control.append(palette);
        control.append(swatch, hex);
      }

      control.append(reset);
      const entry = {
        update: () => {
          update();
          row.classList.toggle("is-changed", isChanged(def));
        },
      };
      rows.set(def.key, entry);
      entry.update();
      return row;
    }

    function refreshRow(key) {
      rows.get(key)?.update();
      // a colour that follows this one shows the new value too
      for (const d of SCHEMA) if (d.follows === key) rows.get(d.key)?.update();
    }

    function checkWallpaper(url, status, setError) {
      status.textContent = "";
      if (!url) return;
      status.textContent = "loading…";
      const img = new Image();
      img.onload = () => {
        if (settings.wallpaper !== url) return;
        status.textContent = `loaded, ${img.naturalWidth} × ${img.naturalHeight}`;
      };
      img.onerror = () => {
        if (settings.wallpaper !== url) return;
        status.textContent = "";
        setError("That picture didn't load. Check the URL; the setting is kept in case it is temporary.");
      };
      img.src = url;
    }

    function categoryHeading(id) {
      if (id === "colors") return `colors · ${schemeKey} scheme`;
      return CATEGORIES.find((c) => c.id === id)?.label || id;
    }

    function resetCategory(id) {
      for (const def of SCHEMA) if (def.cat === id) resetKey(def.key);
      persist();
      show(id, false, '[data-cmd="reset-cat"]');
    }

    function buildSettingsPane(id) {
      const out = [h("h2", { text: categoryHeading(id) })];
      if (id === "colors") out.push(h("p", { class: "zs-help", text: `Changes apply to the ${schemeKey} scheme. The other scheme keeps its own colours. "scheme" resets a colour to color.ini.` }));
      if (id === "quickplay" && isDarkScheme) out.push(h("p", { class: "zs-help", text: "The dark scheme is black everywhere, so these only matter in the light scheme." }));
      for (const def of SCHEMA) {
        if (def.cat !== id) continue;
        // a setting for something that isn't installed stays out of sight
        if (def.available && !def.available()) continue;
        if (def.section) out.push(h("h3", { text: def.section }));
        out.push(buildRow(def));
      }
      const foot = h(
        "div",
        { class: "zs-foot" },
        h("button", { type: "button", class: "zs-cmd", "data-cmd": "reset-cat", text: `reset ${CATEGORIES.find((c) => c.id === id)?.label}`, onclick: () => resetCategory(id) })
      );
      if (id === "nowplaying") foot.append(h("button", { type: "button", class: "zs-cmd is-primary", text: "preview", onclick: () => mix.open() }));
      out.push(foot);
      return out;
    }

    function colorIniSnippet() {
      const base = schemeColors();
      const keys = [
        "text", "subtext", "main", "main-elevated", "highlight", "highlight-elevated", "sidebar", "player", "card", "shadow",
        "selected-row", "button", "button-active", "button-disabled", "tab-active", "notification", "notification-error", "misc",
        "zune-accent", "zune-accent-2", "zune-pivot", "zune-line", "qp-main", "qp-text", "qp-subtext", "qp-pivot", "qp-highlight", "qp-line",
      ];
      const overrides = {};
      for (const def of SCHEMA) if (def.scheme && colorOverrides[def.key]) for (const v of def.vars) overrides[v] = colorOverrides[def.key];
      const lines = [`[${schemeKey}-custom]`];
      for (const k of keys) {
        const v = normHex(overrides[k] || base[`--spice-${k}`]);
        if (v) lines.push(`${k.padEnd(18)} = ${v.slice(1)}`);
      }
      return lines.join("\n");
    }

    function buildBackup() {
      // Each command reports next to itself, so a message is never off-screen.
      const note = () => h("div", { class: "zs-msg", role: "status" });
      const say = (el, t, isError = false) => {
        el.textContent = t;
        el.classList.toggle("is-error", isError);
        el.scrollIntoView({ block: "nearest" });
      };
      const exportMsg = note();
      const importMsg = note();
      const iniMsg = note();
      const resetMsg = note();
      const exportArea = h("textarea", { readonly: true, "aria-label": "Exported settings", spellcheck: "false" });
      exportArea.value = JSON.stringify(exportObject(), null, 2);
      const importArea = h("textarea", { "aria-label": "Settings to import", spellcheck: "false", placeholder: "Paste an export here" });
      const iniArea = h("textarea", { readonly: true, "aria-label": "color.ini scheme", spellcheck: "false" });
      iniArea.value = colorIniSnippet();
      let confirmUntil = 0;
      const resetAllBtn = h("button", { type: "button", class: "zs-cmd is-danger", "data-cmd": "reset-all", text: "reset everything" });
      resetAllBtn.addEventListener("click", () => {
        if (Date.now() > confirmUntil) {
          confirmUntil = Date.now() + 4000;
          resetAllBtn.textContent = "click again to reset";
          setTimeout(() => (resetAllBtn.textContent = "reset everything"), 4000);
          return;
        }
        Object.assign(settings, DEFAULTS);
        colorOverrides = {};
        storedColors = {};
        applyEverything();
        const saved = persist();
        show("backup", false, '[data-cmd="reset-all"]');
        notify(saved ? "Zoone: settings reset" : "Zoone: settings reset for now, but could not be saved", !saved);
      });

      const doImport = () => {
        let parsed;
        try {
          parsed = JSON.parse(importArea.value);
          if (typeof parsed?.version === "number" && parsed.version > VERSION) throw new Error(`This export is from a newer theme (version ${parsed.version}).`);
          parsed = checkStore(parsed, true);
        } catch (e) {
          say(importMsg, e instanceof SyntaxError ? "That is not valid JSON." : e.message, true);
          return;
        }
        Object.assign(settings, DEFAULTS, parsed.values);
        storedColors = parsed.colors;
        colorOverrides = { ...(storedColors[schemeKey] || {}) };
        applyEverything();
        const saved = persist();
        const n = Object.keys(parsed.values).length + Object.values(parsed.colors).reduce((a, m) => a + Object.keys(m).length, 0);
        show("backup", false, '[data-cmd="import"]');
        notify(saved ? `Zoone: imported ${n} setting${n === 1 ? "" : "s"}` : "Zoone: imported for now, but could not be saved", !saved);
      };

      return [
        h("h2", { text: "backup" }),
        h("h3", { text: "export" }),
        h("p", { class: "zs-help", text: "Only settings you changed are listed. Keep a copy, or paste it into another computer's import box." }),
        exportArea,
        h(
          "div",
          { class: "zs-foot" },
          h("button", {
            type: "button",
            class: "zs-cmd",
            text: "copy",
            onclick: async () => say(exportMsg, (await copyText(exportArea.value)) ? "Copied." : "Copy failed. Select the text and copy it."),
          })
        ),
        exportMsg,
        h("h3", { text: "import" }),
        h("p", { class: "zs-help", text: "Paste an export and import it. A file with an unknown key or an out-of-range value is rejected and nothing changes." }),
        importArea,
        h("div", { class: "zs-foot" }, h("button", { type: "button", class: "zs-cmd is-primary", "data-cmd": "import", text: "import", onclick: doImport })),
        importMsg,
        h("h3", { text: "color.ini" }),
        h("p", { class: "zs-help", text: "Your current colours as a color.ini section, to keep or share them. Colour changes already apply as you make them, and light or dark is colors > Theme; this is only for a scheme file of your own." }),
        iniArea,
        h(
          "div",
          { class: "zs-foot" },
          h("button", {
            type: "button",
            class: "zs-cmd",
            text: "copy",
            onclick: async () => say(iniMsg, (await copyText(iniArea.value)) ? "Copied." : "Copy failed. Select the text and copy it."),
          })
        ),
        iniMsg,
        h("h3", { text: "reset" }),
        h("p", { class: "zs-help", text: "Every setting and colour back to the theme defaults." }),
        h("div", { class: "zs-foot" }, resetAllBtn),
        resetMsg,
      ];
    }

    function buildHelp() {
      return [
        h("h2", { text: "help" }),
        h(
          "ul",
          { class: "zs-list" },
          h("li", { html: "Changes apply at once and are saved in Spotify's local storage under <kbd>zune:settings</kbd>." }),
          h("li", { html: "<b>default</b> next to a setting puts it back; <b>scheme</b> next to a colour returns it to color.ini." }),
          h("li", { html: "<kbd>Esc</kbd> closes this page and the now playing view." }),
          h("li", { html: "The pink bars beside the play button open now playing. Scroll over <b>VOLUME</b> to change it." }),
          h("li", { html: "Light or dark: <b>colors &gt; Theme</b>, for every page at once. Each scheme's colours come from the theme's <kbd>color.ini</kbd>." }),
          h("li", { html: "Spotify's own settings are under the <b>spotify</b> tab above." })
        ),
      ];
    }

    function show(id, animate = true, focusSelector = null) {
      const keepScroll = focusSelector ? pane.scrollTop : 0;
      currentCat = id;
      catButtons.forEach((b, i) => {
        const on = CATEGORIES[i].id === id;
        b.setAttribute("aria-selected", String(on));
        b.tabIndex = on ? 0 : -1;
      });
      pane.setAttribute("aria-labelledby", `zs-tab-${id}`);
      // a focus ring on another category would read as a second selection
      if (cats.contains(document.activeElement)) catButtons[CATEGORIES.findIndex((c) => c.id === id)]?.focus({ preventScroll: true });
      rows.clear();
      const content = id === "backup" ? buildBackup() : id === "help" ? buildHelp() : buildSettingsPane(id);
      // one wrapper carries the slide-in, so one element animates instead of every row
      pane.replaceChildren(h("div", { class: "zs-inner" }, ...content));
      pane.scrollTop = keepScroll;
      // the pane's children are new nodes, so the slide-in starts on its own
      pane.classList.toggle("zune-enter", !!animate);
      // A command that rebuilt the pane hands focus to its replacement
      if (focusSelector) pane.querySelector(focusSelector)?.focus({ preventScroll: false });
    }

    // Arrow keys move between categories. Called from the window key
    // handler, because the shield stops events before they reach `cats`.
    function onKey(e) {
      const radio = e.target?.closest?.('.zs-seg [role="radio"]');
      if (radio && ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(e.key)) {
        const group = [...radio.parentElement.querySelectorAll('[role="radio"]')];
        let i = group.indexOf(radio);
        if (e.key === "ArrowRight" || e.key === "ArrowDown") i = (i + 1) % group.length;
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") i = (i - 1 + group.length) % group.length;
        else if (e.key === "Home") i = 0;
        else i = group.length - 1;
        e.preventDefault();
        group[i].click();
        group[i].focus();
        return true;
      }
      if (!cats.contains(e.target) || !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return false;
      e.preventDefault();
      const i = CATEGORIES.findIndex((c) => c.id === currentCat);
      let n = i;
      if (e.key === "ArrowDown") n = (i + 1) % CATEGORIES.length;
      if (e.key === "ArrowUp") n = (i - 1 + CATEGORIES.length) % CATEGORIES.length;
      if (e.key === "Home") n = 0;
      if (e.key === "End") n = CATEGORIES.length - 1;
      show(CATEGORIES[n].id);
      catButtons[n].focus();
      return true;
    }
    overlay.onKey = onKey;

    function layout() {
      const mv = document.getElementById("main-view");
      if (!mv) return;
      const r = mv.getBoundingClientRect();
      // over a Zoone page that fills the window, settings fills it too, so no
      // strip of the page shows beside it
      const fullPage = (settings.pagesFullWidth && /\bzune-(qp|social|browse)-shown\b/.test(document.documentElement.className)) || (settings.browserFullWidth && browser.shown);
      const left = fullPage ? 0 : Math.round(r.left);
      el.style.left = `${left}px`;
      el.style.top = `${Math.round(r.top)}px`;
      el.style.width = `${Math.max(360, Math.round(window.innerWidth - left))}px`;
      el.style.height = `${Math.max(240, Math.round(r.height))}px`;
    }
    let ro = null;
    window.addEventListener("resize", () => isOpen && layout());

    function open(cat, opener) {
      if (cat) currentCat = cat;
      if (isOpen) {
        show(currentCat);
        return;
      }
      isOpen = true;
      lastFocus = opener?.isConnected ? opener : document.activeElement;
      layout();
      el.classList.add("is-open");
      show(currentCat);
      pushOverlay(overlay);
      const mv = document.getElementById("main-view");
      if (mv && window.ResizeObserver) {
        ro = new ResizeObserver(() => layout());
        ro.observe(mv);
      }
      requestAnimationFrame(() => catButtons[CATEGORIES.findIndex((c) => c.id === currentCat)]?.focus({ preventScroll: true }));
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      persistSoon.flush();
      el.classList.remove("is-open");
      ro?.disconnect();
      ro = null;
      popOverlay(overlay);
      if (lastFocus?.isConnected) lastFocus.focus?.({ preventScroll: true });
      lastFocus = null;
    }

    return {
      open,
      close,
      get isOpen() {
        return isOpen;
      },
      onLayoutChange: () => isOpen && requestAnimationFrame(layout),
      // the scheme changed: headings and colour rows show the new one
      refresh: () => isOpen && show(currentCat, false, '[aria-labelledby="zs-l-appearance"] [aria-checked="true"]'),
    };
  })();

  /* ------------------------------------------------------------------ */
  /* collection browser: Zune's ARTISTS | ALBUMS | SONGS columns         */
  /* ------------------------------------------------------------------ */
  const BROWSER_PATH = "/zune/collection";
  const browser = (() => {
    const VIEWS = [
      ["artists", "artists"],
      ["albums", "albums"],
      ["songs", "songs"],
      ["playlists", "playlists"],
    ];
    const el = h("section", { id: "zune-browser", "aria-label": "Collection" });
    const switcher = h("div", { class: "zb-switch", role: "tablist", "aria-label": "Collection views" });
    // the filter narrows every list in the view to names, artists, albums
    // or owners containing all the words typed
    const filter = h("input", { type: "search", class: "zb-filter", placeholder: "filter", "aria-label": "Filter the collection", spellcheck: "false", autocomplete: "off" });
    const revealNote = h("div", { class: "zb-reveal-note", role: "status", hidden: true });
    const revealButton = h("button", { type: "button", class: "zb-reveal", text: "Show playing song", onclick: revealPlaying });
    const bar = h("div", { class: "zb-bar" }, filter, revealButton, switcher);
    const body = h("div", { class: "zb-body" });
    el.append(bar, revealNote, body);
    document.body.append(el);

    const data = {
      followed: null,
      artistsVersion: 0,
      libraryError: false,
      likedError: false,
      albums: null,
      playlists: null,
      loadedAt: 0,
      loading: null,
      liked: [],
      likedRev: 0,
      likedDone: false,
      likedAt: 0,
      likedLoading: null,
      likedSorted: null,
      albumTracks: new Map(),
      playlistTracks: new Map(),
    };
    const state = { view: null, artist: null, album: null, playlist: null, active: {}, songPos: {} };
    let shown = false;
    let songList = null;
    let songSource = { items: [], context: null };
    let renderToken = 0;
    const footers = new Map();
    let pendingPlayback = null;
    const snapshot = (raw = S.Player.data) => ({
      track: raw?.item?.uri || "",
      context: raw?.context?.uri || raw?.context_uri || "",
      paused: typeof raw?.isPaused === "boolean" ? raw.isPaused : null,
    });
    let playback = snapshot();

    function playbackAction(kind, item, context) {
      const current = !!item?.uri && (kind === "song" ? item.uri === playback.track : item.uri === playback.context);
      const action = current ? playback.paused ? "Resume" : "Pause" : "Play";
      const reason = !item ? "Choose an item first." : pendingPlayback ? "Waiting for Spotify…" : !playback.track || playback.paused === null ? "Spotify's player is not ready." : item.isPlayable === false || item.is_playable === false ? "This item is unavailable." : "";
      return { kind, item, context, current, action, reason };
    }

    function finishPlayback(request, message, error = false) {
      if (pendingPlayback !== request) return;
      clearTimeout(request.timer);
      pendingPlayback = null;
      syncActions();
      if (message) notify(message, error);
    }

    function refreshPlayback(raw) {
      const next = snapshot(raw);
      const changed = next.track !== playback.track || next.context !== playback.context || next.paused !== playback.paused;
      playback = next;
      if (pendingPlayback?.matches(next)) finishPlayback(pendingPlayback);
      if (shown && changed) {
        songList?.paint();
        for (const tile of body.querySelectorAll(".zb-album")) paintAlbumPlayback(tile);
      }
      syncActions();
      if (changed) menu.onPlaybackChange();
    }

    function activatePlayback(kind, item, context) {
      refreshPlayback();
      const a = playbackAction(kind, item, context);
      if (a.reason) return notify(a.reason, true);
      const desired = !playback.paused;
      const request = {
        matches: a.current
          ? (p) => (kind === "song" ? p.track === item.uri : p.context === item.uri) && p.paused === desired
          : (p) => p.paused === false && (kind === "song" ? p.track === item.uri : p.context === item.uri),
      };
      pendingPlayback = request;
      request.timer = setTimeout(() => {
        refreshPlayback();
        if (pendingPlayback === request) finishPlayback(request, "Spotify's playback result could not be confirmed.", true);
      }, 3000);
      syncActions();
      try {
        const result = a.current
          ? playback.paused ? S.Player.play() : S.Player.pause()
          : S.Player.playUri(kind === "song" ? context || item.uri : item.uri, {}, kind === "song" && context ? { skipTo: { uri: item.uri } } : {});
        if (result?.then) result.then(() => refreshPlayback(), () => finishPlayback(request, "Spotify could not play that item.", true));
      } catch (_) {
        finishPlayback(request, "Spotify could not change playback.", true);
      }
    }

    const bars = () => h("span", { class: "zb-playing-bars", "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i"));
    function playbackGlyph() {
      return h("span", { class: "zb-play-slot", "aria-hidden": "true", "data-play-action": "" },
        h("span", { class: "zb-track-number" }), bars(), h("span", { class: "zb-play-circle" }));
    }
    function paintGlyph(slot, kind, item, context, number = "") {
      const a = playbackAction(kind, item, context);
      slot.title = `${a.action} ${item?.name || ""}`;
      slot.querySelector(".zb-track-number").textContent = number;
      const circle = slot.querySelector(".zb-play-circle");
      const icon = a.current && playback.paused === false ? "pause" : "play";
      if (circle.dataset.icon !== icon) { circle.innerHTML = ICON[icon]; circle.dataset.icon = icon; }
    }
    function paintAlbumPlayback(tile) {
      const current = !!tile.dataset.uri && tile.dataset.uri === playback.context;
      tile.classList.toggle("is-playing", current);
      tile.classList.toggle("is-paused", current && playback.paused === true);
      const box = tile.closest(".zb-scroll");
      const item = box?._items[Number(tile.dataset.i)];
      if (item) {
        tile.setAttribute("aria-label", `${title(item)}${current ? playback.paused ? ", Paused" : ", Playing" : ""}`);
        paintGlyph(tile.querySelector(".zb-play-slot"), "album", item);
      }
    }

    function actionFooter(box, kind) {
      let f = footers.get(kind);
      if (!f) {
        const button = h("button", { type: "button", class: "zb-action", id: `zb-${kind}-action`, "aria-describedby": `zb-${kind}-reason`, onclick: (e) => {
          if (e.detail > 1 || button.getAttribute("aria-disabled") === "true") return;
          const item = f.box?._items[f.box._active];
          activatePlayback(kind, item, kind === "song" ? songSource.context : null);
        } });
        const reason = h("span", { class: "zb-action-reason", id: `zb-${kind}-reason` });
        button.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          // Keep Spotify's page-level transport shortcut out of this action.
          e.preventDefault();
          e.stopPropagation();
          if (!e.repeat) button.click();
        });
        const node = h("div", { class: "zb-actions", "data-kind": kind }, button, reason);
        f = { node, button, reason, box: null, restore: null };
        footers.set(kind, f);
      }
      f.box = box;
      box._footer = f;
      return f.node;
    }
    function rememberActionFocus(replacedKind) {
      const kind = document.activeElement?.closest?.("#zune-browser .zb-actions")?.dataset.kind;
      if (replacedKind && kind !== replacedKind) return null;
      const f = footers.get(kind);
      const item = f?.box?._items[f.box._active];
      if (item) f.restore = { uri: item.uri, context: kind === "song" ? songSource.context : null };
      // Constructors restore list positions before binding replacement footers.
      if (f) f.box = null;
      return f;
    }
    function syncActions() {
      for (const [kind, f] of footers) {
        if (!f.box) continue;
        if (f.restore) {
          const context = kind === "song" ? songSource.context : null;
          const i = context === f.restore.context ? f.box._items.findIndex((x) => x.uri === f.restore.uri) : -1;
          if (i >= 0) {
            f.restore = null;
            setActive(f.box, i, false);
          }
        }
        const a = playbackAction(kind, f.restore ? null : f.box._items[f.box._active], kind === "song" ? songSource.context : null);
        setText(f.button, a.item ? `${a.action} ${title(a.item)}` : kind === "song" ? "Play selected song" : "Play selected album");
        setAttr(f.button, "aria-label", f.button.textContent);
        setAttr(f.button, "title", f.button.textContent);
        setAttr(f.button, "aria-disabled", String(!!a.reason));
        setText(f.reason, a.reason);
      }
    }
    function inlinePlayback(e, box, kind) {
      if (!e.target.closest?.("[data-play-action]")) return false;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === "click" && e.detail < 2) {
        const row = e.target.closest("[data-i]");
        const item = box._items[Number(row?.dataset.i)];
        activatePlayback(kind, item, kind === "song" ? songSource.context : null);
      }
      return true;
    }

    function refreshPlayingColors() {
      const css = getComputedStyle(root);
      const rgb = (name, fallback) => hexToRgb(css.getPropertyValue(name).trim())?.split(",").map(Number) || fallback;
      const mix = (a, b, amount) => a.map((v, i) => v * (1 - amount) + b[i] * amount);
      const lum = (c) => c.map((v) => { const n = v / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      const a = rgb("--zune-line-a", [236, 0, 140]);
      const b = settings.accentLines === "solid" ? a : rgb("--zune-line-b", [247, 148, 29]);
      let base = rgb("--spice-main", [255, 255, 255]);
      let alpha = settings.playingHighlight === "gradient" && !settings.highContrast ? 0.04 : 0;
      // Per-channel bounds include every gradient color and every selection shade.
      function worst(fg, ink) {
        const samples = [0, 0.03, 0.07].flatMap((shade) => [a, b].map((end) => mix(mix(base, ink, shade), end, alpha)));
        const lo = lum([0, 1, 2].map((i) => Math.min(...samples.map((c) => c[i]))));
        const hi = lum([0, 1, 2].map((i) => Math.max(...samples.map((c) => c[i]))));
        const f = lum(fg);
        if (f >= lo && f <= hi) return 1;
        return Math.min((Math.max(f, lo) + 0.05) / (Math.min(f, lo) + 0.05), (Math.max(f, hi) + 0.05) / (Math.min(f, hi) + 0.05));
      }
      const black = [0, 0, 0], white = [255, 255, 255];
      let ink = worst(black, black) >= worst(white, white) ? black : white;
      if (worst(ink, ink) < 4.5) alpha = 0;
      if (worst(ink, ink) < 4.5) { base = lum(base) > 0.18 ? white : [18, 18, 18]; ink = lum(base) > 0.18 ? black : white; }
      let accent = a;
      for (let i = 0; i <= 10; i++) {
        accent = mix(a, ink, i / 10).map(Math.round);
        if (worst(accent, ink) >= 4.5) break;
      }
      const color = (c) => `rgb(${c.map(Math.round).join(", ")})`;
      el.style.setProperty("--zb-playing-bg", color(base));
      el.style.setProperty("--zb-playing-ink", color(ink));
      el.style.setProperty("--zb-playing-title", color(accent));
      el.style.setProperty("--zb-playing-wash", String(alpha));
    }

    function revealPlaying() {
      refreshPlayback();
      const uri = playback.track;
      const box = songList?.box;
      const matches = (box?._items || []).map((t, i) => t.uri === uri ? i : -1).filter((i) => i >= 0);
      revealNote.hidden = true;
      revealNote.replaceChildren();
      if (matches.length) {
        const top = box._top || 0;
        const index = matches.find((i) => i * rowHeight() >= top && i * rowHeight() < top + box.clientHeight) ?? matches[0];
        box._virtual.reveal(index);
        return;
      }
      const say = (text, label, action) => {
        revealNote.hidden = false;
        revealNote.append(text, action ? h("button", { type: "button", class: "zb-link", text: label, onclick: action }) : "");
      };
      if (!uri) return say("No song is playing.");
      if (songSource.error || (songSource.context === likedContext() && data.likedError)) return say("Couldn't load this song list. ", "Try again", () => (data.likedError ? loadLiked(true) : refreshSongs()).then(revealPlaying));
      if (!songSource.context || (songSource.context === likedContext() && !data.likedDone)) return say("This song list is still loading. ", "Try again", revealPlaying);
      const all = state.view === "playlists" ? data.playlistTracks.get(state.playlist?.uri) : state.album && state.view !== "songs" ? data.albumTracks.get(state.album.uri) : state.artist && state.view === "artists" ? data.liked.filter((t) => t.artists?.some((a) => a.uri === state.artist.uri)) : data.liked;
      if (filterText && all?.some((t) => t.uri === uri)) return say("The current filter hides the playing song. ", "Clear filter and reveal", async () => {
        const selected = box?._items[box._active]?.uri;
        filter.value = filterText = "";
        await refreshSongs();
        const i = songList?.box._items.findIndex((t) => t.uri === selected);
        if (i >= 0) setActive(songList.box, i, false);
        revealPlaying();
      });
      const [, type, id] = uri.split(":");
      say("The playing song is outside this collection view. ", ["track", "episode"].includes(type) ? "Open playing track" : "", ["track", "episode"].includes(type) ? () => History.push(`/${type}/${id}`) : null);
    }

    const playerEvents = S.Player.origin?._events;
    if (typeof playerEvents?.addListener === "function" && typeof playerEvents?.removeListener === "function") {
      const update = ({ data }) => refreshPlayback(data);
      playerEvents.addListener("update", update);
      window.addEventListener("pagehide", () => playerEvents.removeListener("update", update), { once: true });
    }

    // Sort orders, kept between visits under their own key; the filter is
    // for this visit only.
    const PREFS_KEY = "zune:collection";
    const SORTS = {
      albums: [["added", "date added"], ["name", "a-z"], ["artist", "artist"], ["played", "recently played"]],
      songs: [["name", "a-z"], ["artist", "artist"], ["album", "album"], ["added", "date added"], ["length", "length"]],
      playlists: [["name", "a-z"], ["added", "date added"], ["played", "recently played"]],
    };
    const prefs = { albums: "added", songs: "name", songsDir: 1, playlists: "name" };
    try {
      Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"));
    } catch (_) {}
    for (const k of Object.keys(SORTS)) if (!SORTS[k].some(([v]) => v === prefs[k])) prefs[k] = SORTS[k][0][0];
    if (prefs.songsDir !== -1) prefs.songsDir = 1;
    const savePrefs = () => {
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify({ albums: prefs.albums, songs: prefs.songs, songsDir: prefs.songsDir, playlists: prefs.playlists }));
      } catch (_) {}
    };
    let filterText = "";

    const title = (x) => String(x?.name || "").trim();
    const sortKey = (s) => s.replace(/^the\s+/i, "").toLocaleLowerCase();
    // A-Z, ignoring a leading "The", with nameless items last. The key is
    // computed once per item, not once per comparison. Same order as
    // localeCompare (a default collator), far fewer string operations.
    const collator = new Intl.Collator();
    function sortByName(list) {
      const keyed = list.map((item) => [sortKey(title(item)), item]);
      keyed.sort((a, b) => {
        const x = a[0];
        const y = b[0];
        if (!x || !y) return x ? -1 : y ? 1 : 0;
        return collator.compare(x, y);
      });
      return keyed.map((k) => k[1]);
    }

    // the filter: every word typed has to appear in the name, an artist, the
    // album or the owner
    const haystacks = new WeakMap();
    const hayOf = (x) => {
      let t = haystacks.get(x);
      if (t == null) {
        t = [x?.name, ...(x?.artists || []).map((a) => a?.name || a?.profile?.name), x?.album?.name, x?.owner?.name].filter(Boolean).join(" ").toLocaleLowerCase();
        haystacks.set(x, t);
      }
      return t;
    };
    function filtered(list) {
      const words = filterText.toLocaleLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) return list;
      return list.filter((x) => {
        const t = hayOf(x);
        return words.every((w) => t.includes(w));
      });
    }
    // sort keys; a list is sorted once per order and length, then reused
    const stamp = (v) => Date.parse(v || "") || 0;
    const trackPos = (x) => `${String(x?.discNumber || 0).padStart(3, "0")}${String(x?.trackNumber || 0).padStart(4, "0")}`;
    const SORT_KEYS = {
      name: (x) => sortKey(title(x)),
      artist: (x) => `${sortKey(String(x?.artists?.[0]?.name || ""))}\u0001${sortKey(String(x?.album?.name || ""))}\u0001${trackPos(x)}\u0001${sortKey(title(x))}`,
      album: (x) => `${sortKey(String(x?.album?.name || ""))}\u0001${trackPos(x)}`,
      added: (x) => -stamp(x?.addedAt),
      played: (x) => (stamp(x?.lastPlayedAt) ? -stamp(x.lastPlayedAt) : Infinity), // never played: last
      length: (x) => Number(x?.duration?.milliseconds ?? x?.duration ?? 0) || 0,
    };
    const sortCache = new WeakMap();
    function sortedBy(list, by, dir = 1) {
      const key = `${by}|${dir}|${list.length}`;
      const hit = sortCache.get(list);
      if (hit?.key === key) return hit.out;
      const fn = SORT_KEYS[by] || SORT_KEYS.name;
      const keyed = list.map((x) => [fn(x), x]);
      keyed.sort((a, b) => {
        const x = a[0];
        const y = b[0];
        if (typeof x === "number") return (x === y ? 0 : x < y ? -1 : 1) * dir;
        if (!x || !y) return x ? -1 : y ? 1 : 0; // nameless last, either way
        return collator.compare(x, y) * dir;
      });
      const out = keyed.map((k) => k[1]);
      sortCache.set(list, { key, out });
      return out;
    }
    // "12 of 340 artists" while a filter is on
    const counted = (n, total, noun) => (filterText ? `${n.toLocaleString()} of ${total.toLocaleString()} ${noun}` : `${n.toLocaleString()} ${noun}`);
    const noMatch = () => `Nothing here matches "${filterText}".`;
    // a sort choice for a column's head line
    function sortChoice(kind, onPick) {
      const sel = h(
        "select",
        { class: "zb-sort", "aria-label": `Sort ${kind}` },
        ...SORTS[kind].map(([v, label]) => h("option", { value: v, text: `by ${label}`, selected: prefs[kind] === v ? true : null }))
      );
      sel.addEventListener("change", () => onPick(sel.value));
      return h("span", { class: "zb-sortwrap" }, sel, h("span", { class: "zb-caret", "aria-hidden": "true", text: "▾" }));
    }
    const fmtTime = (ms) => {
      const s = Math.max(0, Math.round((ms || 0) / 1000));
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    };
    const artistNames = (t) => (t.artists || []).map((a) => a.name).filter(Boolean).join(", ");
    const remember = (map, key, value) => {
      map.set(key, value);
      if (map.size > 30) map.delete(map.keys().next().value);
      return value;
    };

    /* data ----------------------------------------------------------- */
    // Library lists, paged so a very large library is complete
    async function getAll(filter) {
      const out = [];
      for (let offset = 0, page = 0; page < 25; page++) {
        const r = await S.Platform.LibraryAPI.getContents({ filters: [filter], limit: 2000, offset });
        const items = r?.items || [];
        out.push(...items);
        offset += items.length;
        const total = Number(r?.totalLength);
        if (items.length < 2000 || (total > 0 && offset >= total)) break;
      }
      return out;
    }

    function loadLibrary(force = false) {
      if (!force && data.followed && !data.libraryError && Date.now() - data.loadedAt < 2 * 60 * 1000) return Promise.resolve();
      if (data.loading) {
        // a change arrived mid-load: that load may have missed it, so go again
        if (force) data.libraryAgain = true;
        return data.loading;
      }
      const get = (filter) => getAll(filter).catch(() => null);
      data.loading = Promise.all([get("1"), get("0"), get("2")])
        .then(([ar, al, pl]) => {
          // keep what loaded before if a list fails this time
          if (ar) data.followed = ar.filter((i) => i.type === "artist");
          if (al) data.albums = al.filter((i) => i.type === "album").sort((a, b) => String(b.addedAt || "").localeCompare(String(a.addedAt || "")));
          if (pl) data.playlists = sortByName(pl.filter((i) => String(i.uri || "").startsWith("spotify:playlist:")));
          data.libraryError = !ar || !al || !pl;
          data.loadedAt = Date.now();
          data.artistsVersion++;
          nameMixes();
        })
        .finally(() => {
          data.loading = null;
          if (data.libraryAgain) {
            data.libraryAgain = false;
            loadLibrary(true).then(() => shown && render(false));
          }
        });
      return data.loading;
    }

    // ARTISTS is everyone in your collection, like Zune: artists you follow,
    // plus the artists of saved albums and liked songs. Nobody is followed.
    let artistCache = { key: "", list: [] };
    function artistList() {
      // likedRev changes with every change to the liked songs, so a swap that
      // leaves the count the same still rebuilds the list
      const key = `${settings.browserArtists}|${data.artistsVersion}|${data.likedDone ? data.likedRev : "-"}`;
      if (artistCache.key === key) return artistCache.list;
      const map = new Map();
      const add = (a) => {
        if (a?.uri && title(a) && !map.has(a.uri)) map.set(a.uri, { type: "artist", uri: a.uri, name: title(a) });
      };
      (data.followed || []).forEach(add);
      if (settings.browserArtists === "collection") {
        for (const al of data.albums || []) (al.artists || []).forEach(add);
        if (data.likedDone) for (const t of data.liked) (t.artists || []).forEach(add);
      }
      artistCache = { key, list: sortByName([...map.values()]) };
      return artistCache.list;
    }

    // Spotify's mixes come back from the library without names; ask for them.
    async function nameMixes() {
      const blank = (data.playlists || []).filter((p) => !title(p));
      if (!blank.length) return;
      await Promise.all(
        blank.map((p) =>
          Promise.resolve()
            .then(() => S.Platform.PlaylistAPI.getMetadata(p.uri))
            .then((m) => {
              if (m?.name) p.name = m.name;
              if (!p.owner?.name && m?.owner?.name) p.owner = m.owner;
            })
            .catch(() => {})
        )
      );
      data.playlists = sortByName(data.playlists);
      if (shown && state.view === "playlists") render(false);
    }

    // Liked songs arrive 500 at a time. The first load shows them as they
    // come; a refresh keeps the old list until the new one is complete. A
    // failed page leaves the list marked incomplete, with a retry link.
    function loadLiked(force = false) {
      if (!force && data.likedDone && Date.now() - data.likedAt < 10 * 60 * 1000) return Promise.resolve(data.liked);
      if (data.likedLoading) {
        // something was added mid-load, which the pages already read may lack
        if (force) data.likedAgain = true;
        return data.likedLoading;
      }
      data.likedError = false;
      // songs removed while this load runs: its pages may still hold them
      data.removedDuring = new Set();
      const keep = (list) => (data.removedDuring.size ? list.filter((t) => !data.removedDuring.has(t.uri)) : list);
      const firstLoad = !data.likedDone;
      data.likedLoading = (async () => {
        const all = [];
        let complete = false;
        let shownAt = 0;
        for (let offset = 0; offset < 200000; offset += 500) {
          let items;
          try {
            items = (await S.Platform.LibraryAPI.getTracks({ limit: 500, offset }))?.items || [];
          } catch (_) {
            data.likedError = true;
            break;
          }
          all.push(...items.filter((t) => t?.uri));
          if (firstLoad) {
            data.liked = keep(all);
            data.likedRev++;
            data.likedSorted = null;
            if (shown && Date.now() - shownAt > 500) {
              shownAt = Date.now();
              refreshSongs();
            }
          }
          if (items.length < 500) {
            complete = true;
            break;
          }
        }
        if (complete) {
          data.liked = keep(all);
          data.likedDone = true;
          data.likedAt = Date.now();
        } else if (firstLoad) data.liked = keep(all);
        data.likedRev++;
        data.likedSorted = null;
        data.likedLoading = null;
        data.removedDuring = null;
        if (data.likedAgain) {
          data.likedAgain = false;
          loadLiked(true);
        }
        if (shown) {
          if (state.view === "artists" && settings.browserArtists === "collection") render(false);
          else refreshSongs();
        }
        return data.liked;
      })();
      return data.likedLoading;
    }

    function likedSorted() {
      if (!data.likedSorted) data.likedSorted = sortByName(data.liked);
      return data.likedSorted;
    }

    // Spotify announces every finished library change, wherever it was made
    // (the heart, Spotify's own buttons, the menu, another device). A removed
    // song leaves the lists at once; anything added, or an album, artist or
    // playlist change, reloads them now if the collection is open and on the
    // next visit otherwise.
    function forgetLiked(uris) {
      const gone = new Set(uris);
      if (data.likedLoading && data.removedDuring) {
        for (const u of gone) data.removedDuring.add(u);
        // the load's remaining pages shift by the removal and could skip a
        // song that stays: read the list once more when it finishes
        data.likedAgain = true;
      }
      const before = data.liked.length;
      data.liked = data.liked.filter((t) => !gone.has(t.uri));
      if (data.liked.length === before) return;
      data.likedRev++;
      data.likedSorted = null;
      if (shown) render(false);
    }
    const pendingReload = { liked: false, library: false };
    const reloadSoon = debounce(() => {
      const { liked, library } = pendingReload;
      pendingReload.liked = pendingReload.library = false;
      if (liked) data.likedAt = 0;
      if (library) data.loadedAt = 0;
      if (!shown) return;
      Promise.all([liked ? loadLiked(true) : null, library ? loadLibrary(true) : null])
        .then(() => shown && render(false))
        .catch(() => {});
    }, 700);
    try {
      S.Platform.LibraryAPI.getEvents?.().addListener?.("operation_complete", (ev) => onLibraryOp(ev));
    } catch (_) {
      /* no library events: the lists refresh on their own timers */
    }
    function onLibraryOp(ev) {
      const d = ev?.data || ev || {};
      if (d.error) return;
      const uris = (d.uris || []).map(String);
      const tracks = uris.filter((u) => /^spotify:(track|episode|local):/.test(u));
      if (tracks.length && /remove/i.test(String(d.operation))) forgetLiked(tracks);
      else if (tracks.length) pendingReload.liked = true;
      if (uris.some((u) => /^spotify:(album|artist|playlist|show|user):/.test(u))) pendingReload.library = true;
      if (pendingReload.liked || pendingReload.library) reloadSoon();
    }

    // null means "could not load"; failures are not cached
    async function albumTracks(uri) {
      if (data.albumTracks.has(uri)) return data.albumTracks.get(uri);
      try {
        const def = S.GraphQL?.Definitions?.getAlbum;
        const r = await S.GraphQL.Request(def, { uri, locale: "", offset: 0, limit: 300 });
        const al = r?.data?.albumUnion;
        if (!al) return null;
        const items = (al?.tracksV2?.items || al?.tracks?.items || [])
          .map((x) => x?.track)
          .filter((t) => t?.uri)
          .map((t) => ({
            uri: t.uri,
            name: t.name,
            trackNumber: t.trackNumber,
            discNumber: t.discNumber,
            duration: { milliseconds: t.duration?.totalMilliseconds || 0 },
            artists: (t.artists?.items || []).map((a) => ({ name: a.profile?.name, uri: a.uri })),
            album: { uri, name: al?.name },
          }));
        return remember(data.albumTracks, uri, items);
      } catch (_) {
        return null;
      }
    }

    async function playlistTracks(uri) {
      if (data.playlistTracks.has(uri)) return data.playlistTracks.get(uri);
      try {
        const all = [];
        for (let offset = 0, page = 0; page < 20; page++) {
          const c = await S.Platform.PlaylistAPI.getContents(uri, { offset, limit: 1000 });
          const items = c?.items || [];
          all.push(...items.filter((t) => t?.uri));
          offset += items.length;
          if (items.length < 1000 || (c?.totalLength > 0 && offset >= c.totalLength)) break;
        }
        return remember(data.playlistTracks, uri, all);
      } catch (_) {
        return null;
      }
    }

    /* playback -------------------------------------------------------- */
    function play(contextUri, trackUri) {
      if (!contextUri) return;
      try {
        const p = S.Player.playUri(contextUri, {}, trackUri ? { skipTo: { uri: trackUri } } : {});
        p?.catch?.(() => notify("Zoone: Spotify could not play that", true));
      } catch (_) {
        notify("Zoone: Spotify could not play that", true);
      }
    }
    const likedContext = () => `spotify:user:${me}:collection`;

    /* list widgets ----------------------------------------------------- */
    // A keyboard list: one tab stop, arrows move, Enter plays, click selects.
    function listbox(label, { onSelect, onPlay, grid = false }) {
      const box = h("div", { class: grid ? "zb-scroll zb-grid" : "zb-scroll", role: "listbox", tabindex: "0", "aria-label": label });
      box._items = [];
      box._active = -1;
      box._top = 0;
      box.addEventListener(
        "scroll",
        () => {
          box._top = box.scrollTop;
        },
        { passive: true }
      );
      box.addEventListener("keydown", (e) => {
        const n = box._items.length;
        if (!n) return;
        const none = box._active < 0; // nothing chosen yet: a key picks the first row
        let i = none ? 0 : box._active;
        const cols = grid ? Math.max(1, getComputedStyle(box).gridTemplateColumns.split(" ").length) : 1;
        if (e.key === "ArrowDown") i = Math.min(n - 1, i + cols);
        else if (e.key === "ArrowUp") i = Math.max(0, i - cols);
        else if (grid && e.key === "ArrowRight") i = Math.min(n - 1, i + 1);
        else if (grid && e.key === "ArrowLeft") i = Math.max(0, i - 1);
        else if (e.key === "Home") i = 0;
        else if (e.key === "End") i = n - 1;
        else if (e.key === "PageDown") i = Math.min(n - 1, i + 10 * cols);
        else if (e.key === "PageUp") i = Math.max(0, i - 10 * cols);
        else if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          if (box._active >= 0) onPlay?.(box._items[box._active], box._active);
          return;
        } else if (e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          if (box._active >= 0) onSelect?.(box._items[box._active], box._active);
          return;
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          // type-ahead: the next name starting with what was typed
          e.preventDefault();
          e.stopPropagation();
          const now = Date.now();
          box._typed = now - (box._typedAt || 0) < 800 ? (box._typed || "") + e.key.toLowerCase() : e.key.toLowerCase();
          box._typedAt = now;
          const q = box._typed;
          const from = q.length > 1 ? Math.max(0, box._active) : box._active + 1;
          for (let k = 0; k < n; k++) {
            const j = (from + k) % n;
            if (String(title(box._items[j]) || "").toLowerCase().startsWith(q)) {
              setActive(box, j, true);
              if (!grid) onSelect?.(box._items[j], j, { keyboard: true });
              return;
            }
          }
          return;
        } else return;
        if (none) i = e.key === "End" ? n - 1 : 0;
        e.preventDefault();
        e.stopPropagation();
        setActive(box, i, true);
        if (!grid) onSelect?.(box._items[i], i, { keyboard: true });
      });
      return box;
    }

    // after a column is rebuilt, put its keyboard position back
    function restoreActive(box) {
      const i = state.active[box.id];
      if (i != null && i >= 0 && i < box._items.length) setActive(box, i, false);
    }

    function setActive(box, i, scroll) {
      if (box._footer) box._footer.restore = null;
      box._active = i;
      state.active[box.id] = i;
      if (box._virtual) {
        if (scroll) box._virtual.reveal(i);
        else box._virtual.paint();
        syncActions();
        return;
      }
      box._ensure?.(i);
      box.setAttribute("aria-activedescendant", `${box.id || "zb"}-o${i}`);
      box.querySelector(".is-active")?.classList.remove("is-active");
      const node = box.querySelector(`[data-i="${i}"]`);
      if (node) {
        node.classList.add("is-active");
        if (scroll) node.scrollIntoView({ block: "nearest" });
      }
      syncActions();
    }

    function head(parts, links = [], extra = null) {
      const node = h("div", { class: "zb-head" });
      parts.forEach(([text, strong]) => text && node.append(strong ? h("b", { text }) : h("span", { text })));
      if (extra) node.append(extra);
      if (links.length) {
        const wrap = h("span", { class: "zb-links" });
        for (const [text, fn] of links) wrap.append(h("button", { type: "button", class: "zb-link", text, onclick: fn }));
        node.append(wrap);
      }
      return node;
    }

    function column(cls, ...kids) {
      return h("div", { class: `zb-col ${cls}` }, ...kids);
    }

    function empty(text) {
      return h("div", { class: "zb-empty", text });
    }

    /* columns ---------------------------------------------------------- */
    // A virtual list: only the rows in view exist, they are reused as you
    // scroll, and one listener handles every row's clicks. Thousands of rows
    // cost what a screenful does.
    const setText = (node, text) => {
      if (node.textContent !== text) node.textContent = text;
    };
    const setAttr = (node, name, value) => {
      if (node.getAttribute(name) !== value) node.setAttribute(name, value);
    };
    const rowHeight = () => Number(settings.browserRowHeight) || 28;

    function virtualize(box, { fill, onClick, onDblClick, beforePaint }) {
      const spacer = h("div", { class: "zb-spacer" });
      const win = h("div", { class: "zb-window" });
      spacer.append(win);
      box.append(spacer);
      const pool = [];
      let frame = 0;
      let lastKey = "";
      let version = 0;
      let height = 0; // from a ResizeObserver, never read from layout
      let pendingTop = null; // a scroll position waiting for the first layout
      // The spacer gives the box its scroll height. Size it before any
      // scroll, or a jump into a longer list is clamped to the old height.
      function sizeSpacer() {
        const total = box._items.length * rowHeight();
        if (spacer._total !== total) {
          spacer._total = total;
          spacer.style.height = `${total}px`;
        }
        return total;
      }
      function paint(force = false) {
        frame = 0;
        beforePaint?.();
        const items = box._items;
        const rh = rowHeight();
        const total = sizeSpacer();
        // A list shorter than the saved offset: draw its end now; the browser
        // clamps scrollTop at the next layout and the scroll event follows.
        const view = height || 900;
        const top = Math.max(0, Math.min(box._top, total - view));
        const first = Math.max(0, Math.floor(top / rh) - 8);
        const last = Math.min(items.length, Math.ceil((top + view) / rh) + 8);
        const key = `${first}:${last}:${rh}:${items.length}:${box._active}:${version}`;
        if (!force && key === lastKey) return;
        lastKey = key;
        win.style.transform = `translateY(${first * rh}px)`;
        const n = Math.max(0, last - first);
        for (let k = 0; k < n; k++) {
          const row = pool[k] || (pool[k] = h("div", { role: "option" }));
          fill(row, items[first + k], first + k, rh);
          if (row.parentNode !== win) win.append(row);
        }
        for (let k = n; k < pool.length; k++) if (pool[k].parentNode) pool[k].remove();
        // aria-activedescendant may only name a row that exists
        if (box._active >= first && box._active < last) setAttr(box, "aria-activedescendant", `${box.id}-o${box._active}`);
        else box.removeAttribute("aria-activedescendant");
      }
      box.addEventListener(
        "scroll",
        () => {
          if (!frame) frame = requestAnimationFrame(() => paint());
        },
        { passive: true }
      );
      const sizer = new ResizeObserver(([entry]) => {
        if (!box.isConnected) return sizer.disconnect();
        const next = Math.round(entry.contentRect.height);
        if (!next) return;
        if (pendingTop != null) {
          box.scrollTop = pendingTop; // layout is fresh here, so this is cheap
          box._top = box.scrollTop;
          pendingTop = null;
        }
        if (next !== height) height = next;
        paint();
      });
      sizer.observe(box);
      const indexOf = (e) => {
        const row = e.target.closest?.("[data-i]");
        return row && win.contains(row) ? Number(row.dataset.i) : -1;
      };
      win.addEventListener("click", (e) => {
        const i = indexOf(e);
        if (i >= 0) onClick(i);
      });
      win.addEventListener("dblclick", (e) => {
        const i = indexOf(e);
        if (i >= 0) onDblClick(i);
      });
      box._virtual = {
        paint,
        refresh() {
          version++; // new data or a new playing song: same window, new rows
          paint();
        },
        reveal(i) {
          const rh = rowHeight();
          const view = height || box.clientHeight;
          if (i * rh < box._top) this.scrollTo(i * rh);
          else if ((i + 1) * rh > box._top + view) this.scrollTo((i + 1) * rh - view);
          else paint();
        },
        scrollTo(y) {
          if (!height) {
            // not laid out yet: draw the rows for y now, scroll once there is a layout
            pendingTop = y;
            box._top = y;
          } else {
            sizeSpacer();
            box.scrollTop = y;
            box._top = box.scrollTop; // clamped
          }
          paint();
        },
      };
      return box._virtual;
    }

    function artistColumn() {
      const all = artistList();
      const list = filtered(all);
      const box = listbox("Artists", {
        onSelect: (a, i, opts) => selectArtist(a, opts?.keyboard),
        onPlay: (a) => play(a.uri),
      });
      box.id = "zb-artists";
      box._items = list;
      virtualize(box, {
        fill(row, a, i, rh) {
          const selected = state.artist?.uri === a.uri;
          const cls = `zb-row${selected ? " is-selected" : ""}${i === box._active ? " is-active" : ""}`;
          if (row.className !== cls) row.className = cls;
          setAttr(row, "id", `zb-artists-o${i}`);
          setAttr(row, "data-i", String(i));
          setAttr(row, "data-uri", a.uri || "");
          setAttr(row, "data-name", title(a));
          setAttr(row, "aria-selected", String(selected));
          setAttr(row, "aria-setsize", String(list.length));
          setAttr(row, "aria-posinset", String(i + 1));
          if (row._h !== rh) {
            row._h = rh;
            row.style.height = `${rh}px`;
          }
          setText(row, title(a));
        },
        onClick(i) {
          setActive(box, i, false);
          selectArtist(list[i]);
        },
        onDblClick: (i) => play(list[i].uri),
      });
      if (!list.length) box.append(empty(all.length && filterText ? noMatch() : data.followed ? "No artists in your collection." : "loading…"));
      restoreActive(box);
      const more = settings.browserArtists === "collection" && !data.likedDone ? " · loading…" : "";
      const links = data.libraryError ? [["retry", () => loadLibrary(true).then(() => shown && render(false))]] : [];
      return column("zb-artists", head([[counted(list.length, all.length, "artists"), true], [`a-z${more}`]], links), box);
    }

    function albumsFor() {
      const all = data.albums || [];
      if (!state.artist || state.view !== "artists") return all;
      return all.filter((al) => (al.artists || []).some((a) => a.uri === state.artist.uri));
    }

    // The album grid builds its first screenful at once and the rest over the
    // next frames, so switching views never blocks on 900 tiles.
    function albumColumn() {
      const base = albumsFor();
      const list = filtered(sortedBy(base, prefs.albums));
      const box = listbox("Albums", {
        grid: true,
        onSelect: (al) => selectAlbum(al),
        onPlay: (al) => play(al.uri),
      });
      box.id = "zb-albums";
      box._items = list;
      const tileFor = (al, i) => {
        const names = (al.artists || []).map((a) => a.name).join(", ");
        const tile = h(
          "div",
          { class: "zb-album", role: "option", id: `zb-albums-o${i}`, "data-i": String(i), title: `${title(al)} · ${names}`, "data-uri": al.uri, "data-name": title(al), "data-artist": al.artists?.[0]?.uri || "" },
          h("img", { src: imageUrl(al.images?.[0]?.url) || "", alt: "", loading: "lazy", decoding: "async" }),
          playbackGlyph(),
          h("span", { class: "zb-t" }, nameLinks([{ uri: al.uri, name: title(al), artist: al.artists?.[0]?.uri }], false)),
          h("span", { class: "zb-a" }, nameLinks(al.artists, false))
        );
        if (state.album?.uri === al.uri) {
          tile.classList.add("is-selected");
          tile.setAttribute("aria-selected", "true");
        }
        if (i === box._active) tile.classList.add("is-active");
        const current = al.uri === playback.context;
        tile.classList.toggle("is-playing", current);
        tile.classList.toggle("is-paused", current && playback.paused === true);
        tile.setAttribute("aria-label", `${title(al)}${current ? playback.paused ? ", Paused" : ", Playing" : ""}`);
        paintGlyph(tile.querySelector(".zb-play-slot"), "album", al);
        return tile;
      };
      let built = 0;
      const build = (count) => {
        const frag = document.createDocumentFragment();
        const end = Math.min(list.length, built + count);
        for (; built < end; built++) frag.append(tileFor(list[built], built));
        box.append(frag);
      };
      build(60);
      box._ensure = (i) => {
        if (i >= built) build(i + 1 - built);
      };
      // Enough tiles for the grid to reach y plus a screen: a few layouts of
      // a short grid, instead of building all 900 tiles at once.
      box._reach = (y) => {
        while (built < list.length && box.scrollHeight < y + box.clientHeight + 300) build(160);
      };
      const more = () => {
        if (!box.isConnected || built >= list.length) return;
        build(160);
        requestAnimationFrame(more);
      };
      if (built < list.length) requestAnimationFrame(more);
      const indexOf = (e) => {
        const tile = e.target.closest?.(".zb-album");
        return tile && box.contains(tile) ? Number(tile.dataset.i) : -1;
      };
      for (const type of ["click", "dblclick"]) box.addEventListener(type, (e) => inlinePlayback(e, box, "album"), true);
      box.addEventListener("click", (e) => {
        const i = indexOf(e);
        if (i < 0) return;
        setActive(box, i, false);
        selectAlbum(list[i]);
      });
      box.addEventListener("dblclick", (e) => {
        const i = indexOf(e);
        if (i >= 0) play(list[i].uri);
      });
      restoreActive(box);
      if (!list.length) {
        const note = empty(base.length && filterText ? noMatch() : data.albums ? (state.artist ? `No saved albums by ${title(state.artist)}.` : "No albums in your library.") : "loading…");
        // an artist you follow with nothing saved: their page is one click away
        if (state.artist && data.albums && !base.length) note.append(" ", h("button", { type: "button", class: "zb-link", text: "open their page ›", onclick: () => History.push(`/artist/${state.artist.uri.split(":")[2]}`) }));
        box.append(note);
      }
      const links = [];
      if (state.artist && state.view === "artists") links.push(["all artists", () => selectArtist(null)], ["open artist ›", () => History.push(`/artist/${state.artist.uri.split(":")[2]}`)]);
      const sort = sortChoice("albums", (v) => {
        const focusedFooter = rememberActionFocus("album");
        prefs.albums = v;
        savePrefs();
        state.active["zb-albums"] = -1;
        const col = body.querySelector("#zb-albums")?.closest(".zb-col");
        if (!col) return render(false);
        const fresh = albumColumn();
        col.replaceWith(fresh);
        if (focusedFooter?.node.isConnected) { syncActions(); focusedFooter.button.focus({ preventScroll: true }); }
        else fresh.querySelector(".zb-sort")?.focus({ preventScroll: true });
      });
      return column("zb-albums", head([[counted(list.length, base.length, "albums"), true]], links, sort), box, actionFooter(box, "album"));
    }

    function playlistColumn() {
      const all = data.playlists || [];
      const list = filtered(sortedBy(all, prefs.playlists));
      const box = listbox("Playlists", { onSelect: (p) => selectPlaylist(p), onPlay: (p) => play(p.uri) });
      box.id = "zb-playlists";
      box._items = list;
      list.forEach((p, i) => {
        const row = h("div", { class: "zb-row", role: "option", id: `zb-playlists-o${i}`, "data-i": String(i), "data-uri": p.uri, "data-name": title(p) || "" }, h("span", { class: "zb-title", text: title(p) || "untitled" }), h("span", { class: "zb-dim", text: p.owner?.name || "" }));
        if (state.playlist?.uri === p.uri) {
          row.classList.add("is-selected");
          row.setAttribute("aria-selected", "true");
        }
        row.addEventListener("click", () => {
          setActive(box, i, false);
          selectPlaylist(p);
        });
        row.addEventListener("dblclick", () => play(p.uri));
        box.append(row);
      });
      if (!list.length) box.append(empty(all.length && filterText ? noMatch() : data.playlists ? "No playlists in your library." : "loading…"));
      restoreActive(box);
      const sort = sortChoice("playlists", (v) => {
        prefs.playlists = v;
        savePrefs();
        state.active["zb-playlists"] = -1;
        const col = body.querySelector("#zb-playlists")?.closest(".zb-col");
        if (!col) return render(false);
        const fresh = playlistColumn();
        col.replaceWith(fresh);
        fresh.querySelector(".zb-sort")?.focus({ preventScroll: true });
      });
      return column("zb-playlists", head([[counted(list.length, all.length, "playlists"), true]], [], sort), box);
    }

    // Songs: a virtual list, so ten thousand liked songs scroll smoothly.
    function songColumn(wide) {
      const headSlot = h("div", { class: "zb-headslot" });
      const box = listbox("Songs", {
        onSelect: () => {},
        onPlay: (t) => play(songSource.context, t.uri),
      });
      box.id = "zb-songs";
      let playing = "";
      const virtual = virtualize(box, {
        fill(row, t, i, rh) {
          const mode = wide ? "wide" : state.view === "artists" ? "title" : songSource.showArtist ? "artist" : "plain";
          if (row._mode !== mode) {
            const c = (row._c = {
              num: playbackGlyph(),
              title: h("span", { class: "zb-title" }),
              a: h("span", { class: wide ? "zb-dim" : "zb-dim zb-narrow" }),
              b: h("span", { class: "zb-dim" }),
              time: h("span", { class: "zb-time" }),
            });
            c.num.classList.add("zb-num");
            row.replaceChildren(...(mode === "wide" ? [c.num, c.title, c.a, c.b, c.time] : mode === "artist" ? [c.num, c.title, c.a, c.time] : mode === "title" ? [c.num, c.title] : [c.num, c.title, c.time]));
            row._mode = mode;
          }
          const c = row._c;
          const cls = `zb-row zb-song${t.uri === playing ? " is-playing" : ""}${t.uri === playing && playback.paused === true ? " is-paused" : ""}${i === box._active ? " is-active" : ""}`;
          if (row.className !== cls) row.className = cls;
          setAttr(row, "id", `zb-songs-o${i}`);
          setAttr(row, "data-i", String(i));
          setAttr(row, "data-uri", t.uri || "");
          setAttr(row, "data-name", t.name || "");
          setAttr(row, "data-album", t.album?.uri || "");
          setAttr(row, "data-artist", t.artists?.[0]?.uri || "");
          setAttr(row, "data-ctx", songSource.context || "");
          setAttr(row, "aria-selected", String(i === box._active));
          setAttr(row, "aria-setsize", String(box._items.length));
          setAttr(row, "aria-posinset", String(i + 1));
          if (row._h !== rh) {
            row._h = rh;
            row.style.height = `${rh}px`;
          }
          const length = fmtTime(t.duration?.milliseconds);
          paintGlyph(c.num, "song", t, songSource.context, mode === "title" ? "" : String(songSource.numbered ? t.trackNumber || i + 1 : i + 1));
          setText(c.title, t.name || "");
          // each name its own link, so a click opens it and the rest of the
          // cell still selects the row
          if (mode === "wide" || mode === "artist") fillLinks(c.a, t.artists);
          if (mode === "wide") {
            fillLinks(c.b, [{ uri: t.album?.uri, name: t.album?.name, artist: t.artists?.[0]?.uri }]);
          }
          setAttr(row, "aria-label", `${t.name || ""}, ${artistNames(t)}, ${t.album?.name || ""}, ${length}${t.uri === playing ? playback.paused ? ", Paused" : ", Playing" : ""}`);
          setText(c.time, length);
        },
        onClick: (i) => setActive(box, i, false),
        onDblClick: (i) => play(songSource.context, box._items[i]?.uri),
        beforePaint() {
          playing = playback.track;
          if (box._sourceKey) state.songPos[box._sourceKey] = { top: box._top, active: box._active };
        },
      });
      for (const type of ["click", "dblclick"]) box.addEventListener(type, (e) => inlinePlayback(e, box, "song"), true);
      box.addEventListener(
        "scroll",
        () => {
          if (box._sourceKey) state.songPos[box._sourceKey] = { top: box._top, active: box._active };
        },
        { passive: true }
      );
      songList = { box, headSlot, wide, paint: virtual.refresh };
      // in SONGS the column headings sort; the same one again reverses
      const labels = wide
        ? h(
            "div",
            { class: "zb-colhead" },
            h("span", { "aria-hidden": "true", text: "#" }),
            ...[
              ["name", "title"],
              ["artist", "artist"],
              ["album", "album"],
              ["length", "length"],
            ].map(([key, label]) => h("button", { type: "button", class: "zb-sorthead", "data-sort": key, "data-label": label, onclick: () => setSongSort(key, true) }))
          )
        : null;
      songList.labels = labels;
      paintSongHeads();
      return column(wide ? "zb-songs is-wide" : "zb-songs", headSlot, labels, box, actionFooter(box, "song"));
    }

    function setSongSort(key, fromHeading) {
      if (fromHeading && prefs.songs === key) prefs.songsDir = -prefs.songsDir;
      else {
        prefs.songs = key;
        prefs.songsDir = 1;
      }
      savePrefs();
      paintSongHeads();
      refreshSongs().then(() => {
        // keep focus on the sort control that was used
        if (!fromHeading) songList?.headSlot.querySelector(".zb-sort")?.focus({ preventScroll: true });
      });
    }
    function paintSongHeads() {
      for (const b of songList?.labels?.querySelectorAll(".zb-sorthead") || []) {
        const on = prefs.songs === b.dataset.sort;
        const up = prefs.songsDir === 1;
        b.textContent = on ? `${b.dataset.label} ${up ? "▲" : "▼"}` : b.dataset.label;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-pressed", String(on));
        b.setAttribute("aria-label", `Sort songs by ${b.dataset.label}${on ? (up ? ", ascending; again to reverse" : ", descending; again to reverse") : ""}`);
      }
    }

    async function refreshSongs() {
      if (!songList) return;
      const token = ++renderToken;
      const { box, headSlot } = songList;
      const activeUri = box._items[box._active]?.uri;
      if (document.activeElement === box._footer?.button && activeUri && !box._footer.restore) {
        box._footer.restore = { uri: activeUri, context: songSource.context };
      }
      let src;
      const liked = data.liked;
      const loadingNote = data.likedError ? " · couldn't load them all" : data.likedDone ? "" : " · loading…";
      const likedRetry = data.likedError ? [["retry", () => loadLiked(true)]] : [];
      const failed = (what, retry) => ({ items: [], error: true, sort: "", empty: `Couldn't load ${what}.`, links: [["retry", retry]] });
      if (state.view === "playlists") {
        if (!state.playlist) src = { items: [], label: "pick a playlist", empty: "Pick a playlist to see its songs." };
        else {
          const items = await playlistTracks(state.playlist.uri);
          src = items
            ? { items: filtered(items), total: items.length, context: state.playlist.uri, sort: "playlist order", showArtist: true, links: [["open playlist ›", () => History.push(`/playlist/${state.playlist.uri.split(":")[2]}`)]] }
            : failed("this playlist", () => refreshSongs());
        }
      } else if (state.album && state.view !== "songs") {
        const items = await albumTracks(state.album.uri);
        src = items
          ? { items: filtered(items), total: items.length, context: state.album.uri, sort: "by album", numbered: true, links: [["open album ›", () => History.push(`/album/${state.album.uri.split(":")[2]}`)]] }
          : failed("this album", () => refreshSongs());
      } else if (state.artist && state.view === "artists") {
        const items = sortByName(liked.filter((t) => (t.artists || []).some((a) => a.uri === state.artist.uri)));
        const pickAlbum = albumsFor().length ? " Pick an album to see its songs." : "";
        src = { items: filtered(items), total: items.length, context: likedContext(), sort: `liked, a-z${loadingNote}`, links: likedRetry, empty: data.likedDone ? `No liked songs by ${title(state.artist)}.${pickAlbum}` : "loading…" };
      } else {
        const all = prefs.songs === "name" && prefs.songsDir === 1 ? likedSorted() : sortedBy(data.liked, prefs.songs, prefs.songsDir);
        const sorting = state.view === "songs";
        src = {
          items: filtered(sorting ? all : likedSorted()),
          total: all.length,
          context: likedContext(),
          sort: sorting ? loadingNote.replace(/^ · /, "") : `a-z${loadingNote}`,
          control: sorting ? sortChoice("songs", (v) => setSongSort(v, false)) : null,
          showArtist: true,
          links: [...likedRetry, ["liked songs page ›", () => History.push("/collection/tracks")]],
          empty: data.likedDone ? "No liked songs yet." : "loading…",
        };
      }
      if (filterText && src.total && !src.items.length) src.empty = noMatch();
      if (token !== renderToken || !songList) return;
      // each list (liked, an album, a playlist ...) remembers where you were
      src.key = `${state.view}|${src.context || "none"}|${state.artist?.uri || ""}|${state.view === "songs" ? `${prefs.songs}${prefs.songsDir}` : ""}|${filterText}`;
      const keep = box._sourceKey === src.key; // same column, same list: leave it be
      box._sourceKey = src.key;
      const pos = state.songPos[src.key];
      songSource = src;
      headSlot.replaceChildren(head([[counted(src.items.length, src.total ?? src.items.length, "songs"), true], [src.sort || ""]], src.links || [], src.control || null));
      box._items = src.items;
      box._active = keep ? box._active : pos && pos.active < src.items.length ? pos.active : -1;
      if (keep && activeUri && box._items[box._active]?.uri !== activeUri) box._active = box._items.findIndex((t) => t.uri === activeUri);
      state.active["zb-songs"] = box._active;
      box.querySelector(".zb-empty")?.remove();
      if (!src.items.length) box.append(empty(src.empty || "No songs."));
      if (!keep) box._virtual.scrollTo(pos ? pos.top : 0); // a new list starts at the top
      songList.paint();
      syncActions();
    }

    /* selection --------------------------------------------------------- */
    function selectArtist(a, keyboard = false) {
      state.artist = a && !keyboard && state.artist?.uri === a.uri ? null : a;
      state.album = null;
      const artists = body.querySelector("#zb-artists");
      const albums = body.querySelector("#zb-albums")?.closest(".zb-col");
      if (state.view !== "artists" || !artists?._virtual || !albums || !songList) return render(false);
      artists._virtual.refresh(); // new is-selected marks, same rows
      body.classList.remove("zune-enter"); // a new column, not a new page
      albums.replaceWith(albumColumn());
      refreshSongs();
    }
    function selectAlbum(al) {
      state.album = al && state.album?.uri === al.uri ? null : al;
      const grid = body.querySelector("#zb-albums");
      for (const t of body.querySelectorAll(".zb-album")) {
        const on = !!state.album && grid?._items[Number(t.dataset.i)]?.uri === state.album.uri;
        t.classList.toggle("is-selected", on);
        if (on) t.setAttribute("aria-selected", "true");
        else t.removeAttribute("aria-selected");
      }
      refreshSongs();
    }
    function selectPlaylist(p) {
      state.playlist = p;
      for (const r of body.querySelectorAll("#zb-playlists .zb-row")) {
        const on = body.querySelector("#zb-playlists")._items[Number(r.dataset.i)]?.uri === p?.uri;
        r.classList.toggle("is-selected", on);
        if (on) r.setAttribute("aria-selected", "true");
        else r.removeAttribute("aria-selected");
      }
      refreshSongs();
    }

    // typing filters after a short pause; every list starts again at the top
    const applyFilter = debounce(() => {
      const next = filter.value.trim();
      if (next === filterText) return;
      filterText = next;
      state.active = {};
      for (const sc of body.querySelectorAll(".zb-scroll")) sc._top = 0;
      if (shown) render(false);
    }, 160);
    filter.addEventListener("input", applyFilter);
    filter.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && filter.value) {
        // Esc empties the filter first
        e.preventDefault();
        e.stopPropagation();
        filter.value = "";
        applyFilter();
      } else if (e.key === "Enter" || e.key === "ArrowDown") {
        // into the first list, on its first row
        e.preventDefault();
        const list = body.querySelector(".zb-scroll");
        if (!list) return;
        list.focus({ preventScroll: true });
        if (list._items?.length) {
          setActive(list, 0, true);
          if (list.id === "zb-artists") selectArtist(list._items[0], true);
          else if (list.id === "zb-playlists") selectPlaylist(list._items[0]);
        }
      }
    });
    // Cmd+F (Ctrl+F) on the collection goes to the filter
    window.addEventListener(
      "keydown",
      (e) => {
        if (!shown || overlays.length || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "f") return;
        e.preventDefault();
        e.stopImmediatePropagation();
        filter.focus({ preventScroll: true });
        filter.select();
      },
      true
    );

    function setView(view) {
      if (state.view === view) return;
      state.view = view;
      state.album = null;
      render(true);
    }

    /* render ------------------------------------------------------------ */
    function render(animate) {
      if (!state.view) state.view = settings.browserView;
      // keep keyboard focus in the column that had it
      const focusedId = document.activeElement?.closest?.("#zune-browser .zb-scroll")?.id;
      const focusedFooter = rememberActionFocus();
      const scrolls = {};
      for (const s of body.querySelectorAll(".zb-scroll")) scrolls[s.id] = s._top;

      switcher.replaceChildren(
        ...VIEWS.map(([id, label]) =>
          h("button", { type: "button", role: "tab", "aria-selected": String(state.view === id), tabindex: state.view === id ? "0" : "-1", text: label, onclick: () => setView(id) })
        )
      );
      body.className = `zb-body zb-view-${state.view}`;
      songList = null;
      const cols = [];
      if (state.view === "artists") cols.push(artistColumn(), albumColumn(), songColumn(false));
      else if (state.view === "albums") cols.push(albumColumn(), songColumn(false));
      else if (state.view === "songs") cols.push(songColumn(true));
      else cols.push(playlistColumn(), songColumn(false));
      body.replaceChildren(...cols);
      for (const s of body.querySelectorAll(".zb-scroll")) {
        if (s.id === "zb-songs") continue; // refreshSongs fills and places it
        const y = scrolls[s.id] || 0;
        if (!y) s._virtual?.paint(true);
        else if (s._virtual) s._virtual.scrollTo(y);
        else {
          s._reach?.(y); // the tiles down to the old position
          s.scrollTop = y;
          s._top = s.scrollTop;
        }
      }
      if (focusedId) body.querySelector(`#${focusedId}`)?.focus({ preventScroll: true });
      if (focusedFooter?.node.isConnected) focusedFooter.button.focus({ preventScroll: true });
      // the columns are new nodes, so their slide-in starts on its own
      body.classList.toggle("zune-enter", !!animate);
      refreshSongs();
      syncActions();
    }

    // arrow keys in the view switcher
    switcher.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      const i = VIEWS.findIndex(([id]) => id === state.view);
      let n = i;
      if (e.key === "ArrowRight") n = (i + 1) % VIEWS.length;
      if (e.key === "ArrowLeft") n = (i - 1 + VIEWS.length) % VIEWS.length;
      if (e.key === "Home") n = 0;
      if (e.key === "End") n = VIEWS.length - 1;
      setView(VIEWS[n][0]);
      switcher.children[n]?.focus();
    });

    /* placement ----------------------------------------------------------- */
    function layout() {
      if (!shown) return;
      const mv = document.getElementById("main-view");
      if (!mv) return;
      placeOver(el, settings.browserFullWidth);
    }
    let ro = null;
    window.addEventListener("resize", () => shown && layout());

    // The panes the browser covers must not take focus or clicks
    function syncCovered() {
      coverPanes("browser", shown, settings.browserFullWidth);
    }

    function show(on) {
      on = !!on && settings.collectionBrowser;
      if (on === shown) {
        if (on) {
          layout();
          syncCovered();
        }
        return;
      }
      shown = on;
      el.classList.toggle("is-shown", on);
      root.classList.toggle("zune-browsing", on);
      syncCovered();
      if (on) {
        refreshPlayback();
        refreshPlayingColors();
        layout();
        const mv = document.getElementById("main-view");
        if (mv && window.ResizeObserver) {
          ro = new ResizeObserver(layout);
          ro.observe(mv);
        }
        render(true);
        loadLibrary().then(() => shown && render(false));
        loadLiked();
      } else {
        ro?.disconnect();
        ro = null;
      }
    }

    let appliedView = settings.browserView;
    function onSettings(key) {
      const all = key === "*"; // an import or a reset changed everything
      if (all || key === "collectionBrowser") {
        if (!settings.collectionBrowser && currentPath() === BROWSER_PATH) History.push(settings.collectionTarget);
        else show(currentPath() === BROWSER_PATH);
      }
      if (all || key === "browserFullWidth") {
        layout();
        syncCovered();
      }
      if ((all || key === "browserView") && settings.browserView !== appliedView) {
        appliedView = settings.browserView;
        state.view = settings.browserView;
        state.album = null;
        if (shown) render(true);
      }
      if (all || key === "browserArtists") {
        if (shown && state.view === "artists") render(false);
      } else if (key === "browserRowHeight") for (const s of body.querySelectorAll(".zb-scroll")) s._virtual?.refresh();
      if (all && shown) render(false);
      if (all || ["playingHighlight", "appearance", "accent", "accentLineColor", "accent2", "accentLines", "highContrast"].includes(key)) refreshPlayingColors();
    }

    return {
      el,
      show,
      onSettings,
      onColors: refreshPlayingColors,
      syncCovered: () => shown && syncCovered(),
      albumTracks,
      playlistTracks,
      // after the menu changes the library: fresh lists, the view redrawn
      reloadLibrary: (type) => {
        const jobs = [loadLibrary(true)];
        if (type === "track") jobs.push(loadLiked(true));
        return Promise.all(jobs)
          .then(() => shown && render(false))
          .catch(() => {});
      },
      forgetTracks: (uri) => data.playlistTracks.delete(uri),
      forgetLiked,
      _onLibraryOp: onLibraryOp,
      _liked: () => data.liked,
      _artists: () => artistList().map((x) => x.name),
      _reloadLiked: () => loadLiked(true),
      onSongChange: () => refreshPlayback(),
      onPlayerUpdate: () => (shown || pendingPlayback) && refreshPlayback(),
      playbackToggleLabel: (c) => c.collection && ["track", "local", "album"].includes(c.type) && (c.type === "album" ? c.uri === playback.context : c.uri === playback.track) ? playback.paused ? "Resume" : "Pause" : null,
      togglePlayback: (c) => activatePlayback(c.type === "album" ? "album" : "song", { uri: c.uri, name: c.name }, c.ctx),
      get shown() {
        return shown;
      },
      _state: state,
    };
  })();

  /* ------------------------------------------------------------------ */
  /* quickplay: Zune's start screen in place of Spotify's Home: a sideways */
  /* strip of smart dj, pins, new and history, each a mosaic of covers      */
  /* ------------------------------------------------------------------ */
  const QP_PATH = "/zune/quickplay";
  const isQuickplayPath = (p) => p === "/" || p === QP_PATH;

  // A sideways scroller: the mouse wheel moves it sideways, and the edge with
  // more to see fades, so the overflow reads without a scrollbar.
  function sideways(box) {
    const edges = () => {
      const max = box.scrollWidth - box.clientWidth;
      box.classList.toggle("has-more-left", box.scrollLeft > 4);
      box.classList.toggle("has-more-right", box.scrollLeft < max - 4);
    };
    box.addEventListener(
      "wheel",
      (e) => {
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || box.scrollWidth <= box.clientWidth) return;
        box.scrollLeft += e.deltaY;
        e.preventDefault();
      },
      { passive: false }
    );
    box.addEventListener("scroll", edges, { passive: true });
    return edges;
  }

  const QP_SHAPES = ["is-big", "", "", "is-tall", "is-wide", "", "", "is-big", "", "is-wide", "", "is-tall", "", ""];
  const quickplay = (() => {
    const el = h("section", { id: "zune-qp", "aria-label": "Quickplay" });
    const mark = h("div", { class: "zq-mark", "aria-hidden": "true" });
    // Zune 4.0: one row of smart dj tiles across the top, the other groups in a
    // quieter sideways strip below
    const djRow = h("div", { class: "zq-dj", role: "list", "aria-label": "Smart DJ" });
    const strip = h("div", { class: "zq-strip", role: "list" });
    el.append(mark, djRow, strip);
    document.body.append(el);
    const djEdges = sideways(djRow);
    const stripEdges = sideways(strip);
    let shown = false;
    let items = null;
    let loadedAt = 0;
    let loading = null;
    let failed = false;
    let ro = null;

    const when = (v) => (typeof v === "number" ? v : Date.parse(v) || 0);
    const nameOf = (i) => String(i.name || (i.type === "collection" ? "Liked Songs" : "")).trim();

    function load(force = false) {
      if (!force && items && Date.now() - loadedAt < 2 * 60 * 1000) return Promise.resolve();
      if (loading) return loading;
      loading = (async () => {
        const out = [];
        for (let offset = 0, page = 0; page < 10; page++) {
          const r = await S.Platform.LibraryAPI.getContents({ limit: 2000, offset });
          const got = r?.items || [];
          out.push(...got);
          offset += got.length;
          if (got.length < 2000 || offset >= Number(r?.totalLength || 0)) break;
        }
        // covers only: the mosaics are pictures, as in Zune
        items = out.filter((i) => i?.uri && nameOf(i) && imageUrl(i.images?.[0]?.url) && ["album", "playlist", "artist", "show", "audiobook", "collection"].includes(i.type));
        loadedAt = Date.now();
        failed = false;
      })()
        .catch(() => {
          // keep what loaded before; with nothing, the page offers a retry
          failed = !items;
        })
        .finally(() => {
          loading = null;
        });
      return loading;
    }

    function lists() {
      const all = items || [];
      const recent = (a, b) => when(b.lastPlayedAt) - when(a.lastPlayedAt);
      return {
        dj: all.filter((i) => i.type === "artist").sort(recent).slice(0, settings.quickplayDjCount),
        groups: [
          ["pins", all.filter((i) => i.pinned).slice(0, 12)],
          ["new", all.filter((i) => !i.pinned && i.type !== "artist").sort((a, b) => when(b.addedAt) - when(a.addedAt)).slice(0, 14)],
          ["history", all.filter((i) => i.lastPlayedAt && i.type !== "artist").sort(recent).slice(0, 14)],
        ].filter(([, list]) => list.length),
      };
    }

    function pathOf(item) {
      if (item.type === "collection") return "/collection/tracks";
      const [, type, id] = String(item.uri).split(":");
      return type && id ? `/${type}/${id}` : null;
    }
    function open(item) {
      const p = pathOf(item);
      if (p) History.push(p);
    }
    function play(item) {
      Promise.resolve()
        .then(() => S.Player.playUri(item.uri))
        .catch(() => notify("Zoone: couldn't start that", true));
    }

    // Every tile: a click opens it (smart dj tiles play), and on hover two
    // rings, play and open, as on Zune's quickplay tiles
    function tile(item, i, dj) {
      const name = nameOf(item);
      const src = imageUrl(item.images?.[0]?.url);
      // Zune's quickplay mosaics mixed big, wide, tall and small covers
      const shape = dj ? "" : QP_SHAPES[i % QP_SHAPES.length];
      return h(
        "div",
        { class: `zq-tile${shape ? ` ${shape}` : ""}${dj ? " is-dj" : ""}${item.type === "artist" ? " is-artist" : ""}`, role: "listitem", "data-uri": item.uri, "data-name": name, "data-artist": item.artists?.[0]?.uri || null },
        src ? h("img", { src, alt: "", loading: "lazy", decoding: "async", draggable: "false" }) : h("span", { class: "zq-blank", "aria-hidden": "true", text: name.slice(0, 1).toLowerCase() }),
        dj
          ? h("span", { class: "zq-caption", "aria-hidden": "true" }, h("span", { class: "zq-name", text: name.toLowerCase() }), h("span", { class: "zq-kind", text: "smart dj" }))
          : h("span", { class: "zq-label", "aria-hidden": "true", text: name }),
        h("button", { type: "button", class: "zq-hit", "aria-label": dj ? `Play ${name} smart DJ` : `Open ${name}`, onclick: () => (dj ? smartDj(item.uri, name) : open(item)) }),
        h(
          "span",
          { class: "zq-actions" },
          h("button", { type: "button", class: "zq-ring", "aria-label": `Play ${name}`, html: ICON.play, onclick: () => play(item) }),
          h("button", { type: "button", class: "zq-ring", "aria-label": `Open ${name}`, html: ICON.go, onclick: () => open(item) })
        )
      );
    }

    // a smart dj tile says what it's doing: building, up next, playing
    function paintDj() {
      for (const t of djRow.querySelectorAll(".zq-tile.is-dj")) {
        let state = "";
        try {
          state = djMix.stateOf(t.dataset.uri);
        } catch (_) {}
        const kind = t.querySelector(".zq-kind");
        const text = state ? `smart dj · ${state}` : "smart dj";
        if (kind && kind.textContent !== text) kind.textContent = text;
        t.classList.toggle("is-dj-active", !!state);
        const hit = t.querySelector(".zq-hit");
        if (hit) hit.setAttribute("aria-label", `Play ${t.dataset.name} smart DJ${state ? `, ${state}` : ""}`);
      }
    }

    function render(animate) {
      mark.textContent = String(settings.labelQuickplay || "quickplay").toLowerCase();
      if (failed) {
        djRow.replaceChildren();
        strip.replaceChildren(
          h(
            "p",
            { class: "zq-empty" },
            "Spotify didn't send your library. ",
            h("button", {
              type: "button",
              class: "zq-retry",
              text: "Try again",
              onclick: () => {
                failed = false;
                items = null;
                render(false);
                load(true).then(() => shown && render(true));
              },
            })
          )
        );
        return;
      }
      if (!items) {
        djRow.replaceChildren();
        strip.replaceChildren(h("p", { class: "zq-empty", text: "loading…" }));
        return;
      }
      const { dj, groups } = lists();
      if (!dj.length && !groups.length) {
        djRow.replaceChildren();
        strip.replaceChildren(h("p", { class: "zq-empty", text: "Play or save something, and it shows up here." }));
        return;
      }
      const keepDj = djRow.scrollLeft;
      const keepStrip = strip.scrollLeft;
      djRow.replaceChildren(...dj.map((it, i) => tile(it, i, true)));
      paintDj();
      strip.replaceChildren(
        ...groups.map(([title, entries]) =>
          h("section", { class: "zq-group", role: "listitem", "aria-label": title }, h("h2", { class: "zq-title", text: title }), h("div", { class: "zq-grid", role: "list" }, ...entries.map((it, i) => tile(it, i, false))))
        )
      );
      djRow.scrollLeft = animate ? 0 : keepDj;
      strip.scrollLeft = animate ? 0 : keepStrip;
      requestAnimationFrame(() => {
        djEdges();
        stripEdges();
      });
      if (animate) {
        // the smart dj row first, then each group's title and its covers
        let n = 0;
        for (const t of djRow.children) enter(t, n++);
        for (const g of strip.children) {
          enter(g.firstElementChild, n++);
          for (const t of g.querySelectorAll(".zq-tile")) if (n < 30) enter(t, n++);
        }
      }
    }

    function layout() {
      placeOver(el, settings.pagesFullWidth);
      djEdges();
      stripEdges();
    }
    window.addEventListener("resize", () => shown && layout());

    // The arrow keys move between tiles by where they sit on screen, across
    // the smart dj row and the mosaics of mixed sizes; Home and End jump to
    // the first and last.
    el.addEventListener("keydown", (e) => {
      const from = e.target.closest?.(".zq-tile");
      if (!from || e.altKey || e.ctrlKey || e.metaKey) return;
      const tiles = [...el.querySelectorAll(".zq-tile")];
      let to = null;
      if (e.key === "Home" || e.key === "End") to = e.key === "Home" ? tiles[0] : tiles[tiles.length - 1];
      else {
        const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (!dir) return;
        const c = (r) => [r.left + r.width / 2, r.top + r.height / 2];
        const [fx, fy] = c(from.getBoundingClientRect());
        let best = Infinity;
        for (const t of tiles) {
          if (t === from) continue;
          const [tx, ty] = c(t.getBoundingClientRect());
          const along = (tx - fx) * dir[0] + (ty - fy) * dir[1];
          if (along <= 1) continue;
          // straight ahead beats a nearer tile off to the side
          const across = Math.abs((tx - fx) * dir[1] + (ty - fy) * dir[0]);
          const score = along + across * 2.5;
          if (score < best) {
            best = score;
            to = t;
          }
        }
      }
      e.preventDefault();
      if (!to) return;
      to.querySelector(".zq-hit")?.focus({ preventScroll: true });
      to.scrollIntoView({ block: "nearest", inline: "nearest" });
    });

    function show(on) {
      on = !!on && settings.quickplayView === "zune";
      if (on === shown) {
        if (on) layout();
        return;
      }
      shown = on;
      el.classList.toggle("is-shown", on);
      setClass("zune-qp-shown", on);
      coverPanes("quickplay", on, settings.pagesFullWidth);
      if (on) {
        layout();
        const mv = document.getElementById("main-view");
        if (mv && window.ResizeObserver) {
          ro = new ResizeObserver(layout);
          ro.observe(mv);
        }
        render(true);
        load().then(() => shown && render(!djRow.children.length && !strip.querySelector(".zq-group")));
      } else {
        ro?.disconnect();
        ro = null;
      }
    }

    function onSettings(key) {
      if (key === "*" || key === "quickplayView") {
        const p = currentPath();
        if (settings.quickplayView !== "zune" && p === QP_PATH) History.push("/");
        else if (settings.quickplayView === "zune" && p === "/") History.replace(QP_PATH);
        else show(p === QP_PATH);
      }
      if (shown && (key === "*" || key === "pagesFullWidth")) {
        layout();
        coverPanes("quickplay", true, settings.pagesFullWidth);
      }
      if (shown && (key === "*" || key === "quickplayDjCount" || key === "labelQuickplay")) render(false);
    }

    return {
      show,
      onSettings,
      paintDj: () => shown && paintDj(),
      get isShown() {
        return shown;
      },
      reload: () => load(true).then(() => shown && render(false)),
    };
  })();

  /* ------------------------------------------------------------------ */
  /* social > me: Zune's profile page: name and tagline, a profile card,  */
  /* tabs of Song / Artist / Album lists, and a row of friends            */
  /* ------------------------------------------------------------------ */
  const SOCIAL_PATH = "/zune/social";
  const social = (() => {
    const el = h("section", { id: "zune-social", "aria-label": "Social" });
    document.body.append(el);
    const TABS = [
      ["recently", "Recently"],
      ["favorites", "Favorites"],
      ["toptracks", "Top tracks"],
      ["topartists", "Top artists"],
    ];
    let shown = false;
    let tab = "recently";
    let page = 0;
    let data = null;
    let loadedAt = 0;
    let loading = null;
    let ro = null;
    const names = (t) => (t.artists || []).map((a) => a.name || a.profile?.name).filter(Boolean).join(", ");
    const pathOf = (uri) => {
      const [, type, id] = String(uri || "").split(":");
      return type && id ? `/${type}/${id}` : null;
    };
    const go = (uri) => {
      const p = pathOf(uri);
      if (p) History.push(p);
    };
    const play = (uri) => {
      try {
        S.Player.playUri(uri);
      } catch (_) {
        notify("Zoone: couldn't start that", true);
      }
    };
    const spclient = (path) => S.CosmosAsync.get(`https://spclient.wg.spotify.com/user-profile-view/v3/profile/${encodeURIComponent(me)}${path}`);

    function load(force = false) {
      if (!force && data && Date.now() - loadedAt < 2 * 60 * 1000) return Promise.resolve();
      if (loading) return loading;
      // Spicetify only learns a query once Spotify has run it; this is the
      // profile page's top-content query, used until the live one is known
      const topQuery = S.GraphQL?.Definitions?.userTopContent || { name: "userTopContent", operation: "query", sha256Hash: "61b7353d3625780022dbc63d459eb64cd609e7e5e2a820f9160d65030efe2e15", value: null };
      const top = S.GraphQL?.Request
        ? S.GraphQL.Request(topQuery, {
            includeTopArtists: true,
            topArtistsInput: { offset: 0, limit: 20, sortBy: "AFFINITY", timeRange: "SHORT_TERM" },
            includeTopTracks: true,
            topTracksInput: { offset: 0, limit: 30, sortBy: "AFFINITY", timeRange: "SHORT_TERM" },
          })
        : Promise.reject(new Error("no query"));
      loading = Promise.allSettled([
        spclient("?playlist_limit=0&artist_limit=0&episode_limit=0&market=from_token"),
        S.Platform.PlayHistoryAPI.getContents({ limit: 60 }),
        S.Platform.LibraryAPI.getTracks({ limit: 60, offset: 0 }),
        top,
        spclient("/following?market=from_token"),
        spclient("/followers?market=from_token"),
      ])
        .then(([profile, recent, liked, topC, following, followers]) => {
          const ok = (r) => (r.status === "fulfilled" ? r.value : null);
          const t = ok(topC)?.data?.me?.profile;
          const people = [...(ok(following)?.profiles || []).filter((x) => String(x.uri).startsWith("spotify:user:")), ...(ok(followers)?.profiles || [])];
          const seen = new Set();
          data = {
            profile: ok(profile),
            recently: (ok(recent)?.items || []).filter((x) => x?.type === "track" && x.uri).slice(0, 50),
            plays: (ok(recent)?.items || []).length,
            favorites: (ok(liked)?.items || []).filter((x) => x?.uri).slice(0, 50),
            toptracks: (t?.topTracks?.items || []).map((x) => x?.data).filter((x) => x?.uri).map((x) => ({ uri: x.uri, name: x.name, artists: (x.artists?.items || []).map((a) => ({ uri: a.uri, name: a.profile?.name })), album: { uri: x.albumOfTrack?.uri, name: x.albumOfTrack?.name, images: (x.albumOfTrack?.coverArt?.sources || []).map((s) => ({ url: s.url })) } })),
            topartists: (t?.topArtists?.items || []).map((x) => x?.data).filter((x) => x?.uri).map((x) => ({ uri: x.uri, name: x.profile?.name, image: x.visuals?.avatarImage?.sources?.slice(-1)[0]?.url })),
            friends: people.filter((x) => x?.uri && !seen.has(x.uri) && seen.add(x.uri)),
            following: (ok(following)?.profiles || []).length,
            // lists Spotify didn't send, so the page can offer a retry
            failed: { recently: recent.status !== "fulfilled", favorites: liked.status !== "fulfilled", toptracks: topC.status !== "fulfilled", topartists: topC.status !== "fulfilled", friends: following.status !== "fulfilled" && followers.status !== "fulfilled" },
          };
          loadedAt = Date.now();
        })
        .finally(() => {
          loading = null;
        });
      return loading;
    }

    function linkOut(text, fn) {
      return h("button", { type: "button", class: "zso-link", onclick: fn }, text, h("span", { class: "zso-arrow", "aria-hidden": "true", text: " ↗" }));
    }
    function retry() {
      return h("button", {
        type: "button",
        class: "zq-retry",
        text: "Try again",
        onclick: () => {
          data = null;
          render(false);
          load(true).then(() => shown && render(false));
        },
      });
    }

    function header() {
      const pr = data?.profile;
      const name = String(pr?.name || S.Platform.username || "").trim();
      const count = userMeta.textContent || "";
      return h(
        "div",
        { class: "zso-top" },
        h("div", { class: "zso-who" }, h("h1", { class: "zso-name" }, name.toUpperCase(), " ", h("span", { class: "zso-real", text: [me, pr ? `${pr.followers_count ?? 0} followers · ${pr.following_count ?? 0} following` : ""].filter(Boolean).join("  ") })), h("p", { class: "zso-tag", text: count.toUpperCase() })),
        h("div", { class: "zso-links" }, linkOut("spotify profile", () => History.push(`/user/${me}`)), linkOut("find friends", () => History.push("/search")))
      );
    }

    function card() {
      const pr = data?.profile;
      const covers = [];
      const seen = new Set();
      for (const t of data?.recently || []) {
        const u = imageUrl(t.album?.images?.[0]?.url);
        if (u && !seen.has(t.album?.uri)) {
          seen.add(t.album?.uri);
          covers.push(h("img", { src: u, alt: "", loading: "lazy", decoding: "async" }));
        }
        if (covers.length === 4) break;
      }
      return h(
        "div",
        { class: "zso-side" },
        h(
          "div",
          { class: "zso-card" },
          h("div", { class: "zso-card-head" }, pr?.image_url ? h("img", { src: pr.image_url, alt: "" }) : null, h("div", {}, h("b", { text: pr?.name || me }), h("small", { text: data ? `${(data.plays || 0).toLocaleString()} recent plays` : "" }))),
          h("div", { class: "zso-strip" }, ...covers)
        ),
        h("div", { class: "zso-sidelinks" }, linkOut("view profile", () => History.push(`/user/${me}`)), linkOut("spotify settings", () => History.push("/preferences")), linkOut("following", () => History.push(`/user/${me}/following`)), linkOut("followers", () => History.push(`/user/${me}/followers`)))
      );
    }

    function list() {
      const tabs = h(
        "div",
        { class: "zso-tabs", role: "tablist" },
        ...TABS.map(([id, label]) =>
          h("button", {
            type: "button",
            role: "tab",
            "aria-selected": String(tab === id),
            tabindex: tab === id ? "0" : "-1",
            "data-tab": id,
            text: label,
            onclick: () => {
              tab = id;
              render(false, true);
            },
          })
        )
      );
      // the arrow keys, Home and End move between the tabs and select them
      tabs.addEventListener("keydown", (e) => {
        const i = TABS.findIndex(([id]) => id === tab);
        const n = TABS.length;
        const to = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: n - 1 }[e.key];
        if (to == null || e.altKey || e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        tab = TABS[(to + n) % n][0];
        render(false, true);
      });
      const rows = data?.[tab] || [];
      const playing = S.Player.data?.item?.uri;
      const artistsTab = tab === "topartists";
      const head = h("div", { class: "zso-row zso-colhead", "aria-hidden": "true" }, ...(artistsTab ? [h("span", { text: "Artist" })] : [h("span", { text: "Song" }), h("span", { text: "Artist" }), h("span", { text: "Album" })]));
      const body = h(
        "div",
        { class: "zso-rows", role: "list", "aria-label": TABS.find(([id]) => id === tab)[1] },
        ...(rows.length
          ? rows.map((t, i) => {
              // the first cell plays (double-click, or Enter); names are links
              const first = h("button", {
                type: "button",
                class: "zso-cell zso-play",
                title: "Double-click to play",
                "aria-label": artistsTab ? `${t.name || ""}. Press Enter to play` : `${t.name || ""}, ${names(t)}. Press Enter to play`,
                ondblclick: () => play(t.uri),
                onkeydown: (e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  if (!e.repeat) play(t.uri);
                },
                text: artistsTab ? "" : t.name || "",
              });
              if (artistsTab) {
                first.append(...nameLinks([{ uri: t.uri, name: t.name }], false));
                return h("div", { class: "zso-row", role: "listitem", "data-uri": t.uri, "data-name": t.name || "" }, first);
              }
              const artistsOf = (t.artists || []).map((a) => ({ uri: a.uri, name: a.name || a.profile?.name }));
              return h(
                "div",
                { class: `zso-row${t.uri === playing ? " is-playing" : ""}${i >= 12 ? " is-old" : ""}`, role: "listitem", ondblclick: (e) => !e.target.closest("[data-go], .zso-play") && play(t.uri), "data-uri": t.uri, "data-name": t.name || "", "data-album": t.album?.uri || "", "data-artist": t.artists?.[0]?.uri || "" },
                first,
                h("span", { class: "zso-cell" }, nameLinks(artistsOf)),
                h("span", { class: "zso-cell" }, nameLinks([{ uri: t.album?.uri, name: t.album?.name, artist: t.artists?.[0]?.uri }]))
              );
            })
          : [
              h(
                "p",
                { class: "zso-empty" },
                !data ? "loading…" : data.failed?.[tab] ? ["Spotify didn't send this list. ", retry()] : "Nothing here yet."
              ),
            ])
      );
      return h("div", { class: "zso-main" }, tabs, head, body);
    }

    function friends() {
      const all = data?.friends || [];
      const per = Math.max(4, Math.floor(((el.clientWidth || 1200) - 60) / 92));
      const pages = Math.max(1, Math.ceil(all.length / per));
      page = Math.min(page, pages - 1);
      const shownList = all.slice(page * per, page * per + per);
      const nav = (d) => () => {
        page = (page + d + pages) % pages;
        render(false, false, true);
      };
      return h(
        "div",
        { class: "zso-friends" },
        h(
          "div",
          { class: "zso-friends-head" },
          h("h2", { text: `${String(data?.profile?.name || me).toLowerCase()}'s friends` }),
          h("span", { class: "zso-small", text: "people you follow, and your followers" }),
          all.length ? h("span", { class: "zso-pager" }, `${page * per + 1}-${Math.min(all.length, page * per + per)} of ${all.length}`, h("button", { type: "button", "aria-label": "Previous friends", html: ICON.back, onclick: nav(-1) }), h("button", { type: "button", "aria-label": "Next friends", class: "is-next", html: ICON.back, onclick: nav(1) })) : null
        ),
        h(
          "div",
          { class: "zso-faces", role: "list" },
          ...(shownList.length
            ? shownList.map((f) => h("button", { type: "button", class: "zso-face", role: "listitem", onclick: () => go(f.uri) }, f.image_url ? h("img", { src: f.image_url, alt: "", loading: "lazy" }) : h("span", { class: "zso-noface", text: String(f.name || "?").trim().slice(0, 1) }), h("span", { text: String(f.name || "").trim() })))
            : [h("p", { class: "zso-empty" }, !data ? "loading…" : data.failed?.friends ? ["Spotify didn't send your friends. ", retry()] : "No friends to show yet.")])
        )
      );
    }

    // render: everything; listOnly: a tab change; friendsOnly: paging
    function render(animate, listOnly = false, friendsOnly = false) {
      if (listOnly && el.querySelector(".zso-main")) {
        const fresh = list();
        el.querySelector(".zso-main").replaceWith(fresh);
        snapRows();
        fresh.querySelector('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
        enter(fresh.querySelector(".zso-rows"), 0);
        return;
      }
      if (friendsOnly && el.querySelector(".zso-friends")) {
        const fresh = friends();
        replaceKeepingFocus(el.querySelector(".zso-friends"), fresh);
        fresh.querySelectorAll(".zso-face").forEach((f, i) => enter(f, i));
        return;
      }
      const top = header();
      const mid = h("div", { class: "zso-mid" }, card(), list());
      el.replaceChildren(top, mid, friends());
      snapRows();
      if (animate) {
        let n = 0;
        for (const part of [top, ...mid.children, ...el.querySelectorAll(".zso-face")]) enter(part, n++);
      }
    }

    function layout() {
      placeOver(el, settings.pagesFullWidth);
      snapRows();
    }
    window.addEventListener("resize", () => shown && layout());
    // the song list fills the height that's left, rounded down to whole rows,
    // so its last row isn't cut in half
    let snapFrame = 0;
    function snapRows() {
      cancelAnimationFrame(snapFrame);
      snapFrame = requestAnimationFrame(() => {
        const box = el.querySelector(".zso-rows");
        const row = box?.querySelector(".zso-row");
        if (!box || !row) return;
        box.style.flex = "";
        const rh = row.getBoundingClientRect().height || 25;
        const h = box.getBoundingClientRect().height;
        if (h > rh) box.style.flex = `0 0 ${Math.floor(h / rh) * rh}px`;
      });
    }

    function show(on) {
      on = !!on && settings.socialView === "zune";
      if (on === shown) {
        if (on) layout();
        return;
      }
      shown = on;
      el.classList.toggle("is-shown", on);
      setClass("zune-social-shown", on);
      coverPanes("social", on, settings.pagesFullWidth);
      const mv = document.getElementById("main-view");
      if (on) {
        layout();
        if (mv && window.ResizeObserver) {
          ro = new ResizeObserver(layout);
          ro.observe(mv);
        }
        render(true);
        load().then(() => shown && render(true));
      } else {
        ro?.disconnect();
        ro = null;
      }
    }

    function onSettings(key) {
      if (key === "*" || key === "socialView") {
        const p = currentPath();
        if (settings.socialView !== "zune" && p === SOCIAL_PATH) History.push(`/user/${me}`);
        else show(p === SOCIAL_PATH);
      }
      if (shown && (key === "*" || key === "pagesFullWidth")) {
        layout();
        coverPanes("social", true, settings.pagesFullWidth);
      }
    }

    return {
      show,
      onSettings,
      // the playing song in the accent colour, without redrawing the list
      onSongChange: () => {
        if (!shown) return;
        const uri = S.Player.data?.item?.uri;
        for (const row of el.querySelectorAll(".zso-rows .zso-row[data-uri]")) row.classList.toggle("is-playing", tab !== "topartists" && row.dataset.uri === uri);
      },
    };
  })();

  /* ------------------------------------------------------------------ */
  /* marketplace > browse: Zune's marketplace page. A big title, a genres */
  /* list on the left, featured tiles with caption bands, "we recommend"  */
  /* (new releases from artists you follow) and a numbered top 50         */
  /* ------------------------------------------------------------------ */
  const BROWSE_PATH = "/search";
  const TOP50 = "spotify:playlist:37i9dQZEVXbMDoHDwVN2tF";
  const browse = (() => {
    const el = h("section", { id: "zune-browse", "aria-label": "Browse" });
    document.body.append(el);
    let shown = false;
    let ro = null;
    let genres = [];
    let fresh = null; // new releases
    let chart = null; // top 50
    let feedError = false;
    let chartError = false;
    let loadedAt = 0;
    let loading = null;
    let page = 0;
    let watcher = null;

    const pathOf = (uri) => {
      const [, type, id] = String(uri || "").split(":");
      return type && id ? `/${type}/${id}` : null;
    };
    const go = (uri) => {
      const p = pathOf(uri);
      if (p) History.push(p);
    };
    const play = (uri, track) => {
      try {
        if (track) S.Player.playUri(uri, {}, { skipTo: { uri: track } });
        else S.Player.playUri(uri);
      } catch (_) {
        notify("Zoone: couldn't start that", true);
      }
    };

    // Spotify's own browse page keeps rendering underneath; its category
    // cards are the genres and the featured tiles
    function readGenres() {
      const out = [];
      for (const a of document.querySelectorAll('#main-view #searchPage a[href^="/genre/"]')) {
        const name = a.textContent.trim();
        if (!name) continue;
        out.push({ name, href: a.getAttribute("href"), img: a.querySelector("img")?.src || null });
      }
      return out;
    }
    function watchGenres() {
      watcher?.disconnect();
      const found = readGenres();
      if (found.length) {
        genres = found;
        return;
      }
      const mv = document.getElementById("main-view");
      if (!mv) return;
      const stopAt = Date.now() + 8000;
      watcher = new MutationObserver(() => {
        const list = readGenres();
        if (list.length >= 8 || Date.now() > stopAt) {
          watcher?.disconnect();
          watcher = null;
          if (list.length) {
            genres = list;
            if (shown) render(false);
          }
        }
      });
      watcher.observe(mv, { childList: true, subtree: true });
    }

    function load(force = false) {
      if (!force && !feedError && !chartError && fresh && chart && Date.now() - loadedAt < 10 * 60 * 1000) return Promise.resolve();
      if (loading) return loading;
      // known only once Spotify ran it; this is What's New's own query
      const feedQuery = S.GraphQL?.Definitions?.queryWhatsNewFeed || { name: "queryWhatsNewFeed", operation: "query", sha256Hash: "d889c8c936ab192af8ced595427f5ba2acdf63478fdc0a181c8d477f8322630e", value: null };
      loading = Promise.allSettled([
        S.GraphQL.Request(feedQuery, { offset: 0, limit: 40, onlyUnPlayedItems: false, includedContentTypes: [] }),
        S.Platform.PlaylistAPI.getContents(TOP50, { offset: 0, limit: 20 }),
      ])
        .then(([feed, top]) => {
          feedError = feed.status !== "fulfilled" || !Array.isArray(feed.value?.data?.whatsNewFeedItems?.items);
          chartError = top.status !== "fulfilled" || !Array.isArray(top.value?.items);
          if (!feedError) {
            const seen = new Set();
            fresh = (feed.value?.data?.whatsNewFeedItems?.items || [])
              .map((x) => x?.content?.data)
              .filter((d) => d?.__typename === "Album" && d.uri && !seen.has(d.uri) && seen.add(d.uri))
              .map((d) => ({
                uri: d.uri,
                name: d.name,
                artist: (d.artists?.items || []).map((a) => a.profile?.name).filter(Boolean).join(", "),
                artistUri: d.artists?.items?.[0]?.uri || "",
                artists: (d.artists?.items || []).map((a) => ({ uri: a.uri, name: a.profile?.name })),
                img: d.coverArt?.sources?.find((x) => x.width === 300)?.url || d.coverArt?.sources?.[0]?.url,
              }));
          }
          if (!chartError) {
            chart = (top.value?.items || []).filter((t) => t?.uri).map((t) => ({ uri: t.uri, name: t.name, artist: (t.artists || []).map((a) => a.name).join(", "), artistUri: t.artists?.[0]?.uri || "", artists: (t.artists || []).map((a) => ({ uri: a.uri, name: a.name })), album: t.album?.uri }));
          }
          loadedAt = !feedError && !chartError ? Date.now() : 0;
        })
        .finally(() => {
          loading = null;
        });
      return loading;
    }

    function linkOut(text, fn) {
      return h("button", { type: "button", class: "zbr-more", onclick: fn }, text, h("span", { "aria-hidden": "true", text: " ↗" }));
    }

    function loadError(text) {
      return h("p", { class: "zbr-empty", role: "status" }, text, " ", h("button", {
        type: "button", class: "zbr-more", text: "Try again", onclick: () => load(true).then(() => shown && render(false)),
      }));
    }

    function recommend() {
      const list = fresh || [];
      // as many 118px tiles (14px apart) as the row's own column holds, and a
      // second row when the window has the height for it, as in Zune
      const rec = el.querySelector(".zbr-rec");
      const width = rec?.clientWidth || 600;
      const cols = Math.max(2, Math.floor((width + 14) / 132));
      const main = el.querySelector(".zbr-main");
      const tilesEl = rec?.querySelector(".zbr-tiles");
      const one = tilesEl?.querySelector(".zbr-tile");
      // a laid-out tile's height, or a square cover and two lines of text
      const tileH = one ? one.getBoundingClientRect().height : (width + 14) / cols - 14 + 44;
      const top = tilesEl ? tilesEl.getBoundingClientRect().top : 0;
      const room = top && main ? main.getBoundingClientRect().bottom - top - 8 : 0;
      const rows = room >= tileH * 2 + 14 && list.length > cols ? 2 : 1;
      const per = cols * rows;
      const pages = Math.max(1, Math.ceil(list.length / per));
      page = Math.min(page, pages - 1);
      const nav = (d) => () => {
        page = (page + d + pages) % pages;
        const fresh2 = recommend();
        replaceKeepingFocus(el.querySelector(".zbr-rec"), fresh2);
        fresh2.querySelectorAll(".zbr-tile").forEach((t, i) => enter(t, i));
      };
      return h(
        "section",
        { class: "zbr-rec", "aria-label": "We recommend" },
        h(
          "div",
          { class: "zbr-rowhead" },
          h("h2", { text: "we recommend" }),
          list.length > per ? h("span", { class: "zbr-pager" }, h("button", { type: "button", "aria-label": "Previous", html: ICON.back, onclick: nav(-1) }), h("button", { type: "button", class: "is-next", "aria-label": "Next", html: ICON.back, onclick: nav(1) })) : null
        ),
        feedError ? loadError(list.length ? "Couldn't refresh new releases. Showing the previous results." : "Couldn't load new releases.") : null,
        h(
          "div",
          { class: "zbr-tiles", role: "list", style: `--zbr-per: ${cols}` },
          ...(list.length
            ? list.slice(page * per, page * per + per).map((r) =>
                h(
                  "div",
                  { class: "zbr-tile", role: "listitem", "data-uri": r.uri, "data-name": r.name, "data-artist": r.artistUri },
                  h("button", { type: "button", class: "zbr-cover", title: `${r.name} · ${r.artist}`, "aria-label": `Open ${r.name} by ${r.artist}`, onclick: () => go(r.uri) }, r.img ? h("img", { src: r.img, alt: "", loading: "lazy", decoding: "async" }) : null),
                  h("button", { type: "button", class: "zq-ring zbr-play", "aria-label": `Play ${r.name}`, html: ICON.play, onclick: () => play(r.uri) }),
                  h("span", { class: "zbr-t" }, nameLinks([{ uri: r.uri, name: r.name, artist: r.artistUri }])),
                  h("span", { class: "zbr-a" }, nameLinks(r.artists))
                )
              )
            : feedError ? [] : [h("p", { class: "zbr-empty", text: fresh ? "Follow some artists, and their new releases show up here." : "loading…" })])
        )
      );
    }

    function render(animate) {
      const featured = genres.slice(0, 4);
      const rest = genres.slice(4);
      const head = h("h1", { class: "zbr-title", text: "browse" });
      const side = h(
        "aside",
        { class: "zbr-genres", "aria-label": "Genres" },
        h("h2", { text: "genres" }),
        h("div", { class: "zbr-list", role: "list" }, ...(rest.length ? rest.map((g) => h("button", { type: "button", role: "listitem", text: g.name, onclick: () => History.push(g.href) })) : [h("p", { class: "zbr-empty", text: "loading…" })]))
      );
      const tiles = h(
        "div",
        { class: "zbr-featured", role: "list", "aria-label": "Featured" },
        ...featured.map((g) => h("button", { type: "button", class: "zbr-feature", role: "listitem", onclick: () => History.push(g.href) }, g.img ? h("img", { src: g.img, alt: "", decoding: "async" }) : null, h("span", { class: "zbr-band", text: g.name })))
      );
      const top = h(
        "section",
        { class: "zbr-chart", "aria-label": "Top 50" },
        h("div", { class: "zbr-rowhead" }, h("h2", {}, linkOut("top 50", () => go(TOP50)))),
        chartError ? loadError(chart?.length ? "Couldn't refresh the chart. Showing the previous results." : "Couldn't load the chart.") : null,
        h(
          "ol",
          {},
          ...(chart?.length
            ? chart.map((t) =>
                // a song: double-click or Enter plays it from the chart; the
                // artist names are links of their own
                h(
                  "li",
                  { "data-uri": t.uri, "data-name": t.name, "data-album": t.album || "", "data-artist": t.artistUri, "data-ctx": TOP50 },
                  h("button", {
                    type: "button",
                    class: "zbr-song",
                    title: "Double-click to play",
                    "aria-label": `${t.name}, ${t.artist}. Press Enter to play`,
                    text: t.name,
                    ondblclick: () => play(TOP50, t.uri),
                    onkeydown: (e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      if (!e.repeat) play(TOP50, t.uri);
                    },
                  }),
                  h("span", { class: "zbr-a" }, nameLinks(t.artists))
                )
              )
            : chartError ? [] : [h("li", { class: "zbr-empty", text: chart ? "No tracks in this chart." : "loading…" })])
        )
      );
      const main = h("div", { class: "zbr-main" }, tiles, h("div", { class: "zbr-lower" }, recommend(), top));
      el.replaceChildren(head, h("div", { class: "zbr-body" }, side, main));
      // the recommend row sizes itself from the laid-out width
      requestAnimationFrame(() => {
        fit();
        if (animate) {
          let n = 0;
          for (const part of [head, ...el.querySelectorAll(".zbr-genres h2, .zbr-feature, .zbr-rec, .zbr-chart")]) enter(part, n++);
        }
      });
    }

    function layout() {
      placeOver(el, settings.pagesFullWidth);
    }
    // After layout: the recommend rows that fit, and as much of the chart as
    // reaches the player bar while it stands beside them (a narrow window puts
    // it underneath, and the page scrolls instead).
    function fit() {
      const rec = el.querySelector(".zbr-rec");
      if (rec) replaceKeepingFocus(rec, recommend());
      const main = el.querySelector(".zbr-main");
      const lower = el.querySelector(".zbr-lower");
      const items = [...el.querySelectorAll(".zbr-chart li")];
      items.forEach((li) => (li.hidden = false));
      if (!main || !lower || getComputedStyle(lower).gridTemplateColumns.split(" ").length < 2) return;
      const bottom = main.getBoundingClientRect().bottom - 6;
      items.forEach((li, i) => (li.hidden = i >= 10 && li.getBoundingClientRect().bottom > bottom));
    }
    // the main view changes width with the window and also when a side
    // panel opens or the library collapses: fit again once per frame
    let fitFrame = 0;
    const fitSoon = () => {
      cancelAnimationFrame(fitFrame);
      fitFrame = requestAnimationFrame(() => shown && fit());
    };

    function show(on) {
      on = !!on && settings.browseView === "zune";
      if (on === shown) {
        if (on) layout();
        return;
      }
      shown = on;
      el.classList.toggle("is-shown", on);
      setClass("zune-browse-shown", on);
      coverPanes("browse", on, settings.pagesFullWidth);
      const mv = document.getElementById("main-view");
      if (on) {
        layout();
        if (mv && window.ResizeObserver) {
          ro = new ResizeObserver(() => {
            layout();
            fitSoon();
          });
          ro.observe(mv);
        }
        watchGenres();
        render(true);
        load().then(() => shown && render(false));
      } else {
        watcher?.disconnect();
        watcher = null;
        ro?.disconnect();
        ro = null;
      }
    }

    function onSettings(key) {
      if (key === "*" || key === "browseView") show(currentPath() === BROWSE_PATH);
      if (shown && (key === "*" || key === "pagesFullWidth")) {
        layout();
        coverPanes("browse", true, settings.pagesFullWidth);
        fitSoon();
      }
    }

    return { show, onSettings };
  })();

  /* ------------------------------------------------------------------ */
  /* right-click menus: Zune's menu for a song, album, artist or playlist */
  /* on Zoone's pages. Settings > menus picks what it offers. Names that  */
  /* carry data-go open their page when clicked.                          */
  /* ------------------------------------------------------------------ */
  const SURFACES = "#zune-qp, #zune-browser, #zune-social, #zune-browse, #zune-mixview";
  // Smart dj plays the artist's Spotify radio, as Zune's smart dj played a
  // mix seeded by the artist. With Settings > quickplay > Better Mix smart dj
  // on and the Better Mix extension installed, Better Mix builds its version
  // of that radio meanwhile. Its songs then go into the queue, so they take
  // over from the next song without cutting into the one playing, and the
  // radio carries on after them. Nothing else plays by itself, and nothing
  // the user queued is touched.
  const djMix = (() => {
    const radios = new Map(); // artist -> radio playlist
    const builds = new Map(); // radio -> one build promise, however many clicks
    let run = null; // { artist, radio, phase: building | busy | queued, left: Set, started }

    const betterMix = () => (typeof window.BetterMix?.buildFrom === "function" ? window.BetterMix : null);
    const contextUri = () => S.Player.data?.context?.uri || S.Player.data?.context_uri || "";
    const within = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error("timeout")), ms))]);
    // the one network call, kept apart so tests can stand in for it
    const api = { radio: (artist) => S.CosmosAsync.get(`https://spclient.wg.spotify.com/inspiredby-mix/v2/seed_to_playlist/${artist}?response-format=json`) };

    async function radioOf(artist) {
      if (radios.has(artist)) return radios.get(artist);
      const r = await within(api.radio(artist), 1500);
      const uri = r?.mediaItems?.[0]?.uri;
      if (!/^spotify:playlist:[A-Za-z0-9]+$/.test(uri || "")) throw new Error("no radio");
      radios.set(artist, uri);
      return uri;
    }
    function build(radio, name) {
      if (!builds.has(radio)) {
        const job = (async () => {
          const meta = await within(S.Platform.PlaylistAPI.getMetadata(radio), 3000).catch(() => null);
          return betterMix().buildFrom(radio, String(meta?.name || `${name || "Artist"} Radio`), { seed: "zoone-smart-dj" });
        })()
          .catch(() => null)
          .finally(() => builds.delete(radio));
        builds.set(radio, job);
      }
      return builds.get(radio);
    }
    const set = (next) => {
      run = next;
      quickplay.paintDj?.();
    };
    // Each start gets a number; a later start, or the user playing something
    // else, makes an earlier one stand down at its next step.
    let gen = 0;
    const queueNow = async () => (await Promise.resolve(S.Platform.PlayerAPI.getQueue?.()).catch(() => null))?.queued || [];
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    // Smart dj owns exactly the queue entries it added, by their uid. A song
    // the user queued too has its own uid and is never touched. A failed add
    // claims nothing: an entry that appeared meanwhile may be the user's, so
    // whatever is uncertain stays in the queue.
    async function add(batch, owned) {
      const before = new Set((await queueNow()).map((t) => t.uid));
      await S.addToQueue(batch.map((uri) => ({ uri })));
      const want = new Set(batch);
      // the queue can take a moment to show the new entries
      let full = false;
      for (let tries = 0; tries < 10; tries++) {
        const fresh = (await queueNow()).filter((t) => t?.uid && !before.has(t.uid) && want.has(t.uri));
        // once every song shows, look once more: a copy the user queued at
        // the same moment gets the chance to appear, and then counts as two
        if (fresh.length >= batch.length && !full && tries < 9) {
          full = true;
          await pause(100);
          continue;
        }
        if (full || tries === 9) {
          // A song is claimed only when exactly one new entry for it
          // appeared. Two means the user queued the same song meanwhile;
          // there's no telling which is whose, so both are left alone.
          const count = new Map();
          for (const t of fresh) count.set(t.uri, (count.get(t.uri) || 0) + 1);
          for (const t of fresh) if (count.get(t.uri) === 1) owned.push({ uri: t.uri, uid: t.uid });
          return;
        }
        await pause(100);
      }
    }
    // Removing while Spotify switches to something else can be undone by the
    // switch, so look again a moment later and remove what came back, a few
    // times at most. Only these exact entries, by uid.
    async function remove(entries) {
      let left = entries;
      for (let tries = 0; left.length && tries < 4; tries++) {
        await Promise.resolve(S.Platform.PlayerAPI.removeFromQueue(left)).catch(() => {});
        await pause(tries ? 1200 : 800);
        const still = new Set((await queueNow()).map((t) => t.uid));
        left = left.filter((e) => still.has(e.uid));
      }
    }
    // its entries still waiting in the queue
    async function waiting(r) {
      return (await queueNow()).filter((t) => r.uids.has(t?.uid)).map((t) => ({ uri: t.uri, uid: t.uid }));
    }
    // After the mix, smart dj carries on with the rest of the radio itself,
    // leaving out every song the mix had (by entry, or by title and artist)
    // and the radio songs already heard, so nothing comes round twice.
    // "Song - Remastered" and "Song (feat. X)" are the same song; "Hi-Fi" is not "Hi"
    const songKey = (t) => `${String(t?.name || "").toLowerCase().replace(/\s+[-–—]\s.*$|\s*[([].*$/, "").trim()}|${String(t?.artists?.[0]?.name || "").toLowerCase()}`;
    async function radioAfter(radio, mix, heard) {
      const r = await within(S.Platform.PlaylistAPI.getContents(radio, { limit: 200 }), 4000).catch(() => null);
      const had = new Set(mix.map((t) => t.uri));
      const keys = new Set(mix.map(songKey));
      return (r?.items || []).filter((t) => t?.uri && t.isPlayable !== false && !heard.has(t.uri) && !had.has(t.uri) && !keys.has(songKey(t))).map((t) => t.uri);
    }
    // Only the next two mix songs wait in the queue, so anything the user
    // queues meanwhile plays within a song or two instead of after the
    // whole mix. Each mix song that starts brings in the next one.
    const AHEAD = 2;
    async function topUp(r) {
      const need = AHEAD - (await waiting(r)).length;
      if (need <= 0 || !r.rest.length || run !== r) return;
      const owned = [];
      try {
        await add(r.rest.splice(0, need), owned);
      } finally {
        owned.forEach((o) => r.uids.set(o.uid, o.uri));
        if (run !== r) await remove(owned); // moved on meanwhile
      }
    }
    async function stop() {
      const old = run;
      if (!old) return;
      set(null);
      if (old.phase === "queued") await remove(await waiting(old));
    }
    // a queue write failed: end the run if it is still this one, and take
    // back the entries it owns that still wait; the radio plays on
    async function fail(r) {
      if (run !== r) return;
      set(null);
      await remove(await waiting(r));
    }
    const away = () => !quickplay.isShown;

    async function start(artist, name = "") {
      if (!artist) return;
      const my = ++gen;
      const was = contextUri();
      const live = () => my === gen;
      const radio = await radioOf(artist).catch(() => null);
      // a later click, or the user started something else meanwhile
      if (!live() || contextUri() !== was) return;
      await stop();
      if (!live()) return;
      try {
        // the radio if Spotify answered in time, else the artist
        await S.Player.playUri(radio || artist);
      } catch (_) {
        return notify("Zoone: Spotify could not start smart DJ", true);
      }
      if (!live() || !radio || !settings.smartDjBetterMix || !betterMix()) return;
      // uids: its queue entries still to play, uid -> song
      // seen: entries that played during the run, so going back to one
      // (Previous) isn't taken for the user moving on
      // seen and heard: radio songs that played before the mix took over.
      // Right after playUri Spotify may still report the song from before,
      // so only a song from the radio itself counts.
      const onRadio = contextUri() === radio && S.Player.data?.item;
      const mine = { artist, radio, phase: "building", uids: new Map(), rest: [], started: false, seen: new Set([onRadio?.uid].filter(Boolean)), heard: new Set([onRadio?.uri].filter(Boolean)), mixSet: new Set(), now: "" };
      set(mine);
      const ok = () => live() && run === mine;
      const res = await build(radio, name);
      if (!ok()) return; // another start, or the user moved on
      if (res?.busy) {
        // a build of Better Mix's own is running: the radio plays on
        if (away()) notify("Zoone: Better Mix is busy, so smart DJ plays Spotify's radio");
        return set({ ...mine, phase: "busy" });
      }
      if (!res?.mix?.tracks?.length || contextUri() !== radio) return set(null);
      const now = S.Player.data?.item?.uri;
      if (now) mine.heard.add(now);
      const mix = res.mix.tracks.filter((t) => t?.uri && t.uri !== now);
      const after = await radioAfter(radio, res.mix.tracks, mine.heard);
      if (!ok()) return;
      const queued = { ...mine, phase: "queued", rest: [...mix.map((t) => t.uri), ...after], mixSet: new Set(mix.map((t) => t.uri)) };
      if (S.Player.data?.item?.uid) queued.seen.add(S.Player.data.item.uid);
      const ahead = (await queueNow()).length; // songs the user had queued
      if (!ok()) return;
      set(queued);
      try {
        await topUp(queued);
      } catch (_) {
        return fail(queued);
      }
      if (run !== queued) return;
      if (!(await waiting(queued)).length) return set(null);
      if (away()) notify(ahead ? "Zoone: Better Mix takes over after your queued songs" : "Zoone: Better Mix takes over after this song");
    }

    // one song change at a time: topping up waits on the queue
    let changes = Promise.resolve();
    function onSongChange() {
      changes = changes.then(songChanged).catch(() => {});
      return changes;
    }
    async function songChanged() {
      const r = run;
      if (!r) return;
      const ctx = contextUri();
      const item = S.Player.data?.item;
      if (r.phase !== "queued") {
        if (ctx !== r.radio) {
          gen++; // moved on before the mix was ready: nothing gets queued
          set(null);
        } else if (item?.uid) {
          r.seen.add(item.uid); // a radio song while it builds
          if (item.uri) r.heard.add(item.uri);
        }
        return;
      }
      // a song that already played during the run, again (Previous): only
      // within the radio; the user's own songs elsewhere are moving on
      if (item?.uid && ctx === r.radio && r.seen.has(item.uid)) return;
      // one of its own entries, by uid: the mix is playing; bring in the next
      let own = item?.uid && r.uids.has(item.uid) ? item.uid : null;
      if (!own && item?.provider === "queue" && item.uri) {
        // in case Spotify gives an entry a new uid as it plays: one of its own
        // entries for this song that has left the queue (the user's copy of
        // the same song leaves smart dj's entry waiting, so it never matches)
        const still = new Set((await queueNow()).map((t) => t.uid));
        if (run !== r) return; // a new start meanwhile owns the state
        for (const [uid, uri] of r.uids) if (uri === item.uri && !still.has(uid)) own = uid;
      }
      if (item?.uid) r.seen.add(item.uid);
      if (own) {
        r.uids.delete(own);
        // the mix's songs, then the rest of the radio
        const part = r.mixSet.has(item.uri) ? "mix" : "radio";
        if (!r.started || r.now !== part) set({ ...r, started: true, now: part });
        const now = run;
        await topUp(now).catch(() => fail(now));
        return;
      }
      // anything else outside the radio, even a song that is also in the
      // mix: the user moved on, so its waiting entries come back out
      if (ctx !== r.radio) {
        gen++;
        set(null);
        await remove(await waiting(r));
        return;
      }
      // a song the user queued: the mix waits behind it
      if (item?.provider === "queue") return;
      // a radio song: the mix ran out, or its songs were taken out of the queue
      set(null);
      await remove(await waiting(r));
    }

    return {
      start,
      onSongChange,
      // for the tile's caption: what smart dj is doing for this artist
      stateOf: (artist) => (run && run.artist === artist ? (run.phase === "queued" ? (run.started ? (run.now === "radio" ? "radio" : "better mix") : "better mix next") : run.phase === "busy" ? "radio" : "building…") : ""),
      get available() {
        return !!betterMix();
      },
      _state: () => run,
      _api: api,
    };
  })();
  function smartDj(artistUri, name) {
    return djMix.start(artistUri, name).catch(() => notify("Zoone: Spotify could not start smart DJ", true));
  }
  const menu = (() => {
    const el = h("div", { id: "zune-menu", role: "menu", "aria-label": "Options" });
    const sub = h("div", { id: "zune-menu-sub", role: "menu", "aria-label": "Playlists" });
    // one overlay element holds both panels, so Tab, Esc and the key shield
    // treat them as one menu
    const wrap = h("div", { id: "zune-menus" }, el, sub);
    document.body.append(wrap);
    let ctx = null;
    let target = null;
    let at = { x: 0, y: 0 };
    let restoreFocus = null;
    let playlists = null;
    let subToken = 0;
    let subFor = null;
    let openedAt = 0;
    const overlay = { el: wrap, close, onKey, escape, ownTab: true };

    const typeOf = (uri) => {
      const parts = String(uri || "").split(":");
      if (parts[1] === "user" && parts[3] === "collection") return "collection";
      return parts[1] || "";
    };
    const idOf = (uri) => String(uri || "").split(":")[2] || "";
    const pathOf = (uri) => (typeOf(uri) === "collection" ? "/collection/tracks" : uri && idOf(uri) && typeOf(uri) !== "local" ? `/${typeOf(uri)}/${idOf(uri)}` : null);
    const go = (uri) => {
      const p = pathOf(uri);
      if (!p) return;
      mix.close?.();
      History.push(p);
    };
    const say = (text, isError = false) => notify(text, isError);
    const plural = (n) => (n === 1 ? "1 song" : `${n} songs`);

    async function tracksOf(c) {
      if (c.type === "track" || c.type === "episode" || c.type === "local") return [c.uri];
      const list = c.type === "album" ? await browser.albumTracks(c.uri) : c.type === "playlist" ? await browser.playlistTracks(c.uri) : null;
      return (list || []).map((t) => t.uri).filter(Boolean);
    }
    // Spotify takes a long list better in pieces
    const BATCH = 100;
    const batches = (uris) => {
      const out = [];
      for (let i = 0; i < uris.length; i += BATCH) out.push(uris.slice(i, i + BATCH));
      return out;
    };
    async function queue(c, next) {
      const uris = await tracksOf(c);
      if (!uris.length) return say("Zoone: nothing to add", true);
      const parts = batches(uris);
      try {
        // "play next" puts each piece at the front, so the last piece goes first
        if (next) for (const p of parts.reverse()) await S.Platform.PlayerAPI.playAsNextInQueue(p.map((uri) => ({ uri })));
        else for (const p of parts) await S.addToQueue(p.map((uri) => ({ uri })));
        const what = uris.length === 1 ? c.name || "1 song" : plural(uris.length);
        say(next ? `Zoone: ${what} ${uris.length === 1 ? "plays" : "play"} next` : `Zoone: added ${what} to now playing`);
      } catch (_) {
        say("Zoone: Spotify couldn't change the queue", true);
      }
    }
    const play = (c) =>
      Promise.resolve()
        .then(() => ((c.type === "track" || c.type === "local") && c.ctx ? S.Player.playUri(c.ctx, {}, { skipTo: { uri: c.uri } }) : S.Player.playUri(c.uri)))
        .catch(() => say("Zoone: Spotify could not play that", true));
    async function toggleSaved(c) {
      const artist = c.type === "artist";
      try {
        // saved playlists live in the rootlist, everything else in the library
        if (c.type === "playlist") {
          if (c.saved) await S.Platform.RootlistAPI.remove([{ uri: c.uri }]);
          else await S.Platform.RootlistAPI.add([c.uri], { before: "start" });
        } else if (c.saved) await S.Platform.LibraryAPI.remove({ uris: [c.uri] });
        else await S.Platform.LibraryAPI.add({ uris: [c.uri] });
        say(artist ? `Zoone: ${c.saved ? "unfollowed" : "following"} ${c.name || "the artist"}` : `Zoone: ${c.saved ? "removed from" : "added to"} your collection`);
        browser.reloadLibrary?.(c.type);
      } catch (_) {
        say(artist ? "Zoone: Spotify couldn't change who you follow" : "Zoone: Spotify couldn't change your collection", true);
      }
    }
    async function togglePin(c) {
      try {
        if (c.pinned) await S.Platform.LibraryAPI.unpin(c.uri);
        else await S.Platform.LibraryAPI.pin(c.uri);
        say(c.pinned ? "Zoone: unpinned" : "Zoone: pinned to quickplay");
        quickplay.reload?.();
      } catch (_) {
        say("Zoone: Spotify couldn't change your pins", true);
      }
    }
    async function addToPlaylist(c, pl) {
      const uris = await tracksOf(c);
      if (!uris.length) return say("Zoone: nothing to add", true);
      try {
        for (const p of batches(uris)) await S.Platform.PlaylistAPI.add(pl.uri, p, { after: "end" });
        browser.forgetTracks?.(pl.uri);
        say(`Zoone: added ${uris.length === 1 ? c.name || "1 song" : plural(uris.length)} to ${pl.name}`);
      } catch (_) {
        say("Zoone: Spotify couldn't add to that playlist", true);
      }
    }
    async function ownPlaylists() {
      if (playlists) return playlists;
      try {
        const r = await S.Platform.LibraryAPI.getContents({ filters: ["2"], limit: 2000 });
        playlists = (r?.items || []).filter((p) => String(p.uri).startsWith("spotify:playlist:") && (p.isOwnedBySelf || p.canAddTo)).map((p) => ({ uri: p.uri, name: String(p.name || "untitled").trim() }));
        playlists.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      } catch (_) {
        playlists = [];
      }
      setTimeout(() => (playlists = null), 60000);
      return playlists;
    }

    // what the menu can offer, in Zune's order; Settings > menus switches each one
    const TRACKS = ["track", "local", "album", "playlist", "episode"];
    const ACTIONS = [
      { key: "menuPlay", label: () => "Play", types: [...TRACKS, "artist", "show", "collection"], run: play },
      { key: "menuPlay", id: "menuPlaybackToggle", label: (c) => browser.playbackToggleLabel(c), types: ["track", "local", "album"], when: (c) => !!browser.playbackToggleLabel(c), run: (c) => browser.togglePlayback(c) },
      { key: "menuPlayNext", label: () => "Play next", types: TRACKS, run: (c) => queue(c, true) },
      { key: "menuQueue", label: () => "Add to now playing", types: TRACKS, run: (c) => queue(c, false) },
      { key: "menuPlaylist", label: () => "Add to playlist", types: ["track", "album", "playlist"], sub: true },
      { key: "menuAlbum", label: () => "Go to album", types: ["track"], when: (c) => !!c.album, run: (c) => go(c.album) },
      { key: "menuArtist", label: () => "Go to artist", types: ["track", "album"], when: (c) => !!c.artist, run: (c) => go(c.artist) },
      { key: "menuSave", label: (c) => (c.type === "artist" ? (c.saved ? "Unfollow" : "Follow") : c.saved ? "Remove from collection" : "Add to collection"), types: ["track", "album", "artist", "playlist", "show"], run: toggleSaved },
      // Spotify pins only what is in your library
      { key: "menuPin", label: (c) => (c.pinned ? "Unpin from quickplay" : "Pin to quickplay"), types: ["album", "artist", "playlist", "show", "collection"], when: (c) => c.pinned || c.saved || c.type === "collection", run: togglePin },
      { key: "menuDj", label: () => "Start smart DJ", types: ["track", "album", "artist"], when: (c) => !!(c.type === "artist" ? c.uri : c.artist), run: (c) => smartDj(c.type === "artist" ? c.uri : c.artist, c.type === "artist" ? c.name : "") },
      { key: "menuCopy", label: () => "Copy link", types: ["track", "album", "artist", "playlist", "show", "episode"], run: (c) => S.Platform.ClipboardAPI.copy(`https://open.spotify.com/${c.type}/${idOf(c.uri)}`).then(() => say("Zoone: link copied")) },
    ];
    const visible = () => ACTIONS.filter((a) => settings[a.key] && a.types.includes(ctx.type) && (!a.when || a.when(ctx)));
    // run an action on the context it was opened for: close() forgets it
    const run = (fn) =>
      Promise.resolve()
        .then(fn)
        .catch(() => say("Zoone: that didn't work", true));

    function place(node, x, y) {
      node.style.left = "0px";
      node.style.top = "0px";
      node.classList.add("is-open");
      const r = node.getBoundingClientRect();
      node.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
      node.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
    }
    function placeSub(host) {
      const r = host.getBoundingClientRect();
      // the left side when the right has no room
      const w = sub.getBoundingClientRect().width || 200;
      place(sub, r.right - 2 + w > innerWidth - 4 ? r.left - w + 2 : r.right - 2, r.top - 4);
    }
    const items = (node) => [...node.querySelectorAll('[role="menuitem"]')];
    function focusItem(node) {
      if (!node) return;
      node.focus({ preventScroll: true });
      if (sub.contains(node)) node.scrollIntoView({ block: "nearest" });
    }

    function build() {
      const list = visible();
      el.replaceChildren(
        ...list.map((a) =>
          h("button", {
            type: "button",
            role: "menuitem",
            tabindex: "-1",
            class: a.sub ? "has-sub" : "",
            "data-key": a.id || a.key,
            "aria-haspopup": a.sub ? "menu" : null,
            "aria-expanded": a.sub ? String(!!subFor) : null,
            text: a.label(ctx),
            onclick: () => {
              if (a.sub) return openSub(true);
              const c = ctx;
              close();
              run(() => a.run(c));
            },
            onmouseenter: (e) => {
              if (a.sub) openSub(false);
              else closeSub();
              focusItem(e.currentTarget);
            },
          })
        )
      );
      return list.length;
    }
    // saved / pinned state arrives after the menu opens: relabel in place, and
    // rebuild only if the items change, keeping focus where it was
    function relabel() {
      const keys = visible().map((a) => a.id || a.key);
      const now = items(el);
      if (keys.join() === now.map((b) => b.dataset.key).join()) {
        for (const b of now) b.textContent = ACTIONS.find((a) => (a.id || a.key) === b.dataset.key).label(ctx);
        return;
      }
      const focused = el.contains(document.activeElement) ? document.activeElement.dataset.key : null;
      build();
      place(el, at.x, at.y);
      const host = el.querySelector(".has-sub");
      if (subFor && host) placeSub(host);
      if (focused) focusItem(el.querySelector(`[data-key="${focused}"]`) || items(el)[0]);
    }

    async function openSub(focus) {
      const host = el.querySelector(".has-sub");
      if (!host) return;
      const c = ctx;
      if (subFor === c && sub.classList.contains("is-open")) {
        if (focus) focusItem(items(sub)[0]);
        return;
      }
      const token = ++subToken;
      subFor = c;
      host.setAttribute("aria-expanded", "true");
      sub.replaceChildren(h("div", { class: "zmenu-note", text: "loading…" }));
      placeSub(host);
      const lists = await ownPlaylists();
      // the pointer or the keys may have moved on while the list loaded
      if (token !== subToken || ctx !== c) return;
      const mine = lists.filter((pl) => pl.uri !== c.uri);
      sub.replaceChildren(
        ...(mine.length
          ? mine.map((pl) =>
              h("button", {
                type: "button",
                role: "menuitem",
                tabindex: "-1",
                text: pl.name,
                onclick: () => {
                  close();
                  run(() => addToPlaylist(c, pl));
                },
                onmouseenter: (e) => focusItem(e.currentTarget),
              })
            )
          : [h("div", { class: "zmenu-note", text: "You have no playlists of your own." })])
      );
      placeSub(el.querySelector(".has-sub") || host);
      if (focus || sub.contains(document.activeElement)) focusItem(items(sub)[0]);
    }
    function closeSub() {
      subToken++;
      subFor = null;
      sub.classList.remove("is-open");
      el.querySelector(".has-sub")?.setAttribute("aria-expanded", "false");
    }
    // Esc: the playlist list first, then the menu
    function escape() {
      if (!sub.classList.contains("is-open")) return false;
      const back = sub.contains(document.activeElement) || document.activeElement === document.body;
      closeSub();
      if (back) focusItem(el.querySelector(".has-sub"));
      return true;
    }

    function open(node, x, y) {
      const uri = node.dataset.uri;
      const type = typeOf(uri);
      if (!uri || !type) return false;
      close();
      ctx = { uri, type, name: node.dataset.name || "", album: node.dataset.album || "", artist: node.dataset.artist || "", ctx: node.dataset.ctx || "", collection: !!node.closest("#zune-browser"), saved: false, pinned: false };
      if (!build()) {
        ctx = null;
        return false;
      }
      restoreFocus = document.activeElement;
      openedAt = performance.now();
      target = node;
      target.classList.add("is-menu-target");
      at = { x, y };
      place(el, x, y);
      pushOverlay(overlay);
      focusItem(items(el)[0]);
      const c = ctx;
      Promise.all([
        (type === "playlist" ? S.Platform.RootlistAPI.contains([uri]) : S.Platform.LibraryAPI.contains(uri)).catch(() => [false]),
        ["album", "artist", "playlist", "show", "collection"].includes(type) ? S.Platform.LibraryAPI.getIsPinned(uri).catch(() => [false]) : Promise.resolve([false]),
      ]).then(([saved, pinned]) => {
        if (ctx !== c) return;
        c.saved = !!saved?.[0];
        c.pinned = !!pinned?.[0];
        relabel();
      });
      return true;
    }

    function close() {
      if (!el.classList.contains("is-open")) return;
      el.classList.remove("is-open");
      closeSub();
      target?.classList.remove("is-menu-target");
      target = null;
      popOverlay(overlay);
      if (restoreFocus?.isConnected) restoreFocus.focus?.({ preventScroll: true });
      restoreFocus = null;
      ctx = null;
    }

    // type-ahead: the first item starting with what was typed
    let typed = "";
    let typedAt = 0;
    function onKey(e) {
      if (e.key === "Tab") {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
        return;
      }
      const inSub = sub.contains(document.activeElement);
      const list = items(inSub ? sub : el);
      const i = list.indexOf(document.activeElement);
      const n = list.length;
      const move = (node) => {
        if (!inSub && node !== el.querySelector(".has-sub")) closeSub();
        focusItem(node);
      };
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (n) move(list[(i + (e.key === "ArrowDown" ? 1 : -1) + n) % n]);
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        move(list[e.key === "Home" ? 0 : n - 1]);
      } else if (e.key === "ArrowRight" && !inSub && document.activeElement?.classList.contains("has-sub")) {
        e.preventDefault();
        openSub(true);
      } else if (e.key === "ArrowLeft" && inSub) {
        e.preventDefault();
        closeSub();
        focusItem(el.querySelector(".has-sub"));
      } else if (e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey && n) {
        e.preventDefault();
        const now = Date.now();
        typed = now - typedAt < 700 ? typed + e.key.toLowerCase() : e.key.toLowerCase();
        typedAt = now;
        const from = typed.length > 1 ? Math.max(0, i) : i + 1;
        for (let k = 0; k < n; k++) {
          const node = list[(from + k) % n];
          if (node.textContent.trim().toLowerCase().startsWith(typed)) return move(node);
        }
      }
    }

    // right-click on anything that carries a data-uri on Zoone's pages
    document.addEventListener("contextmenu", (e) => {
      if (!settings.menusOn) return;
      const node = e.target.closest?.("[data-uri]");
      if (!node || !node.closest(SURFACES)) return;
      if (open(node, e.clientX, e.clientY)) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    // The menu key or Shift+F10 opens the menu for what has focus (for a
    // listbox, its active option); Enter on a name link opens its page. Called
    // from the window key handler, ahead of any overlay's key shield, so it
    // works inside the mix view too.
    surfaceKey = (e) => {
      const a = document.activeElement;
      if (e.key === "Enter" && !e.repeat && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && a?.matches?.("[data-go]") && a.closest(SURFACES)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        go(a.dataset.go);
        return true;
      }
      if (!settings.menusOn || !(e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey))) return false;
      // a virtual list drops its active row (and the attribute) once it
      // scrolls away: bring the row back first
      if (a?._virtual && a._active >= 0) a._virtual.reveal(a._active);
      const id = a?.getAttribute?.("aria-activedescendant");
      const node = (id && document.getElementById(id)?.closest("[data-uri]")) || a?.closest?.("[data-uri]");
      if (!node || !node.closest(SURFACES)) return false;
      const r = node.getBoundingClientRect();
      const x = Math.min(Math.max(r.left + 12, 4), innerWidth - 4);
      const y = Math.min(Math.max(r.top + Math.min(r.height, 24), 4), innerHeight - 4);
      if (!open(node, x, y)) return false;
      e.preventDefault();
      e.stopImmediatePropagation();
      return true;
    };
    // names that open their page
    document.addEventListener(
      "click",
      (e) => {
        const link = e.target.closest?.("[data-go]");
        if (!link || !link.closest(SURFACES) || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        go(link.dataset.go);
      },
      true
    );
    // anything else closes it
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (el.classList.contains("is-open") && !wrap.contains(e.target)) close();
      },
      true
    );
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    document.addEventListener(
      "scroll",
      (e) => {
        // the scroll that revealed the row the menu is for doesn't count
        if (!wrap.contains(e.target) && performance.now() - openedAt > 250) close();
      },
      true
    );

    return { open, close, go, onPlaybackChange: () => ctx && relabel() };
  })();

  /* ------------------------------------------------------------------ */
  /* the heart: Spotify's filled "Add to playlist" check opens its        */
  /* playlist picker. With Settings > player > Heart removes a like, a    */
  /* click on it takes the song out of Liked Songs, as Zune's heart did.  */
  /* Option-click (Alt-click) still opens the picker.                     */
  /* ------------------------------------------------------------------ */
  const heart = (() => {
    // Spotify's label for the saved check, in its own language (English too)
    const labels = new Set(["Add to playlist"]);
    for (const key of ["web-player.aligned-curation.tooltips.add-to-playlist", "contextmenu.add-to-playlist", "web-player.aligned-curation.title"]) {
      try {
        const v = S.Locale?.get?.(key);
        if (typeof v === "string" && v && !v.includes(key)) labels.add(v);
      } catch (_) {}
    }
    const FILLED = [...labels].map((l) => `button[aria-label="${CSS.escape(l)}"][aria-checked="true"]`).join(", ");
    let passThrough = false;
    // the song a heart belongs to: a track row's own song, or the playing
    // song for the player bar and the now playing panel
    function songOf(btn) {
      const row = btn.closest('[role="row"], [data-testid="tracklist-row"]');
      if (row) {
        const href = row.querySelector('a[href*="/track/"]')?.getAttribute("href") || "";
        const id = /\/track\/([A-Za-z0-9]{22})/.exec(href)?.[1];
        return id ? `spotify:track:${id}` : trackFromReact(row);
      }
      if (btn.closest('[data-testid="now-playing-bar"], #Desktop_PanelContainer_Id')) {
        const uri = S.Player.data?.item?.uri || "";
        return uri.startsWith("spotify:track:") ? uri : null;
      }
      // a song's own page
      const id = /^\/track\/([A-Za-z0-9]{22})/.exec(currentPath())?.[1];
      return id && btn.closest('[data-testid="action-bar-row"]') ? `spotify:track:${id}` : null;
    }
    // Album and artist rows have no link to their song; the row's own React
    // props, a couple of levels up, carry its uri
    function trackFromReact(node) {
      const key = Object.keys(node).find((k) => k.startsWith("__reactFiber"));
      let f = key ? node[key] : null;
      for (let depth = 0; f && depth < 8; depth++, f = f.return) {
        const p = f.memoizedProps;
        const uri = typeof p?.uri === "string" ? p.uri : typeof p?.track?.uri === "string" ? p.track.uri : "";
        if (/^spotify:track:[A-Za-z0-9]{22}$/.test(uri)) return uri;
      }
      return null;
    }
    async function unlike(btn, uri) {
      try {
        const [liked] = await S.Platform.LibraryAPI.contains(uri);
        if (!liked) {
          // only in playlists, not Liked Songs: Spotify's picker, as before
          passThrough = true;
          try {
            btn.click();
          } finally {
            passThrough = false;
          }
          return;
        }
        await S.Platform.LibraryAPI.remove({ uris: [uri] });
        browser.forgetLiked?.([uri]);
        notify("Zoone: removed from Liked Songs");
      } catch (_) {
        notify("Zoone: Spotify couldn't change your Liked Songs", true);
      }
    }
    document.addEventListener(
      "click",
      (e) => {
        if (passThrough || !settings.heartUnlikes || e.altKey || e.button !== 0) return;
        const btn = e.target.closest?.(FILLED);
        if (!btn) return;
        const uri = songOf(btn);
        if (!uri) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        unlike(btn, uri);
      },
      true
    );
    return { songOf };
  })();

  /* ------------------------------------------------------------------ */
  /* HELP: a theme dialog, so Esc, focus and stacking are handled        */
  /* ------------------------------------------------------------------ */
  const help = (() => {
    const el = h("div", { id: "zune-help", role: "dialog", "aria-modal": "true", "aria-labelledby": "zh-title" });
    const box = h("div", { class: "zh-box" });
    el.append(box);
    el.addEventListener("pointerdown", (e) => {
      if (e.target === el) close();
    });
    document.body.append(el);
    let isOpen = false;
    let lastFocus = null;
    const overlay = { el, close: () => close() };

    function build() {
      box.replaceChildren(
        h("h2", { id: "zh-title", text: "help" }),
        h(
          "ul",
          {},
          h("li", { html: "Click the pink bars next to the play button for <b>now playing</b>. <kbd>Esc</kbd> or the back circle leaves it." }),
          h("li", { html: "Scroll over <b>VOLUME</b> to change it. Click it for a slider and mute." }),
          h("li", { html: "The pivots follow the page you are on. In marketplace the sub-pivots become the big row." }),
          h("li", { html: "On Zoone's pages, click an artist or album name to open it. Right-click a song, album, artist or playlist (or press <kbd>Shift</kbd>+<kbd>F10</kbd>) for its menu; <b>SETTINGS &gt; menus</b> picks what the menu offers." }),
          h("li", { html: "In the collection lists, type the first letters of a name to jump to it. <kbd>Cmd</kbd>+<kbd>F</kbd> goes to the collection's <b>filter</b>; the column heads sort. The arrow keys move between Quickplay's tiles." }),
          h("li", { html: "A filled heart removes the like; Option-click it for Spotify's playlist picker. In now playing's up next, double-click or <kbd>Enter</kbd> plays from a song, and <kbd>Delete</kbd> removes one you queued." }),
          h("li", { html: "<b>SETTINGS</b> opens the theme settings. Spotify's own settings are under its <b>spotify</b> tab." }),
          h("li", { html: "Switch between light and dark in <b>SETTINGS &gt; colors &gt; Theme</b>." })
        ),
        h(
          "div",
          { class: "zh-foot" },
          h("button", {
            type: "button",
            class: "zs-cmd is-primary",
            text: "open settings",
            onclick: () => {
              const opener = lastFocus;
              close(false);
              settingsPage.open(undefined, opener);
            },
          }),
          h("button", { type: "button", class: "zs-cmd", text: "close", onclick: () => close() })
        )
      );
    }

    function open() {
      if (isOpen) return;
      isOpen = true;
      lastFocus = document.activeElement;
      build();
      el.classList.add("is-open");
      pushOverlay(overlay);
      requestAnimationFrame(() => box.querySelector("button")?.focus({ preventScroll: true }));
    }

    function close(restore = true) {
      if (!isOpen) return;
      isOpen = false;
      el.classList.remove("is-open");
      popOverlay(overlay);
      if (restore && lastFocus?.isConnected) lastFocus.focus?.({ preventScroll: true });
      lastFocus = null;
    }

    return { open, close };
  })();

  /* ------------------------------------------------------------------ */
  /* mounting and events                                                 */
  /* ------------------------------------------------------------------ */
  // Collapsed library rail: no column padding, centred covers
  let libObserved = null;
  const libObserver = window.ResizeObserver
    ? new ResizeObserver((entries) => {
        for (const entry of entries) {
          setClass("zune-lib-collapsed", entry.contentRect.width < 140);
          // "Expand Your Library" lays the library over the page
          const mv = document.getElementById("main-view")?.getBoundingClientRect();
          setClass("zune-lib-expanded", !!mv && entry.target.getBoundingClientRect().right > mv.left + 8);
        }
      })
    : null;

  // Tag Spotify's containers once with data-zune="…", so the stylesheet can
  // match them directly. The alternative, :has(), is re-evaluated whenever
  // Spotify changes the page (every second while music plays) and cost up
  // to 70 ms per update.
  function tag(node, value) {
    if (node && node.getAttribute("data-zune") !== value) node.setAttribute("data-zune", value);
  }
  function untag(node, value) {
    if (node && node.getAttribute("data-zune") === value) node.removeAttribute("data-zune");
  }
  function tagDom() {
    const nav = document.getElementById("global-nav-bar");
    const grid = nav?.parentElement;
    if (grid) {
      tag(grid, "grid");
      for (const cell of grid.children) {
        if (cell === nav || cell.id || cell.tagName !== "DIV") continue;
        if (cell.querySelector(':scope > aside[data-testid="now-playing-bar"]')) tag(cell, "player-cell");
        else if (cell.querySelector("#Desktop_PanelContainer_Id")) tag(cell, "right-cell");
        else if (cell.querySelector('[style*="--lyrics-color-active"]')) tag(cell, "lyrics-cell");
        else untag(cell, "lyrics-cell");
      }
      let n = document.getElementById("Desktop_PanelContainer_Id")?.parentElement;
      while (n && n !== grid && n.getAttribute("data-zune") !== "right-cell") {
        tag(n, "panel-wrap");
        n = n.parentElement;
      }
    }
    if (nav) {
      for (const c of nav.children) {
        if (c.tagName !== "DIV" || c.id) continue;
        if (c.querySelector("form")) tag(c, "search-cell");
        else if (c.querySelector('[data-testid="user-widget-link"]')) tag(c, "account-cell");
      }
      const left = nav.querySelector(":scope > div");
      if (left) for (const d of left.querySelectorAll(":scope > div > div")) if (!d.classList.contains("custom-navlinks-scrollable_container") && d.querySelector(":scope > button")) tag(d, "history");
      tag(nav.querySelector("form")?.parentElement, "search-wrap");
    }
    const bar = $('aside[data-testid="now-playing-bar"] > div');
    if (bar) {
      for (const c of bar.children) {
        if (c.id) continue;
        if (c.querySelector('[data-testid="now-playing-widget-v2"]')) tag(c, "np-widget");
        else if (c.querySelector(':scope > [data-testid="player-controls"]')) tag(c, "np-controls");
        else if (c.querySelector('[data-testid="control-button-queue"], [data-testid="volume-bar"], [data-testid="lyrics-button"]')) tag(c, "np-extras");
      }
      tag(bar.querySelector('[data-testid="playback-progressbar"]')?.closest('[data-testid="player-controls"] > div'), "np-progress");
    }
    // Spotify's scrolling titles in the player bar and the now playing panel:
    // tag the clipped box around each title and artist link, so the CSS can
    // end long names with an ellipsis instead of a hard cut
    for (const scope of [$('[data-zune="np-widget"]'), document.getElementById("Desktop_PanelContainer_Id")]) {
      if (!scope) continue;
      const boxes = new Set();
      for (const a of scope.querySelectorAll('a[href^="/album/"], a[href^="/track/"], a[href^="/artist/"], a[href^="/episode/"], a[href^="/show/"]')) {
        if (a.closest('[data-encore-id="card"], [data-encore-id="listRow"]')) continue;
        let x = a.parentElement;
        if (x?.tagName !== "SPAN") continue;
        while (x.parentElement?.tagName === "SPAN") x = x.parentElement;
        const box = x.parentElement;
        if (box?.tagName !== "DIV") continue;
        tag(box, "marquee");
        boxes.add(box);
      }
      // the element holding the words clips and draws the ellipsis in its own
      // font; the wrappers between it and the box just fill the width. With
      // several artists it is the element around all their links, so the
      // links and the ", " between them stay on one line.
      for (const box of boxes) {
        const links = [...box.querySelectorAll("a")];
        let words = links.length === 1 ? links[0].querySelector('[data-encore-id="text"]') || links[0].closest('[data-encore-id="text"]') : links[0]?.parentElement;
        if (links.length > 1) while (words && words !== box && !links.every((l) => words.contains(l))) words = words.parentElement;
        if (!words || words === box || !box.contains(words)) continue;
        for (const old of box.querySelectorAll("[data-zune-text], [data-zune-chain]")) {
          if (old !== words && words.contains(old)) {
            old.removeAttribute("data-zune-text");
            old.removeAttribute("data-zune-chain");
          }
        }
        if (!words.hasAttribute("data-zune-text")) words.setAttribute("data-zune-text", "");
        for (let w = words.parentElement; w && w !== box; w = w.parentElement) if (!w.hasAttribute("data-zune-chain")) w.setAttribute("data-zune-chain", "");
      }
    }
    // the library's filter chips: wrap onto two lines instead of scrolling
    // under an arrow
    const chips = [...document.querySelectorAll('#Desktop_LeftSidebar_Id [role="listbox"]')].find((l) => l.querySelector('[data-encore-id="chip"]'));
    if (chips) {
      tag(chips, "lib-chips");
      const scroller = chips.parentElement?.parentElement;
      tag(scroller, "lib-chips-scroll");
      const holder = scroller?.parentElement;
      if (holder) for (const c of holder.children) if (c !== scroller) tag(c, "lib-chips-arrows");
    }
    // A Canvas video in the now playing panel: tag its box, so the light theme
    // keeps the video inside it instead of darkening the whole panel
    const video = document.querySelector("#Desktop_PanelContainer_Id video");
    let videoBox = null;
    if (video) {
      let w = video.parentElement;
      for (let d = 0; w && d < 6 && getComputedStyle(w).position !== "absolute"; d++) w = w.parentElement;
      if (w && getComputedStyle(w).position === "absolute") videoBox = w.parentElement;
    }
    for (const old of document.querySelectorAll('[data-zune="panel-video"]')) if (old !== videoBox) untag(old, "panel-video");
    tag(videoBox, "panel-video");
    setClass("zune-panel-video", !!video);
    // the left tray: name each of Spotify's buttons, so the CSS can order and
    // size them like Zune's device, disc and playlist glyphs
    const tray = $('[data-zune="np-extras"] > div');
    if (tray) {
      for (const c of tray.children) {
        const has = (sel) => c.matches(sel) || !!c.querySelector(sel);
        const t = has('[data-testid="lyrics-button"]') ? "lyrics" : has('[data-testid="control-button-queue"]') ? "queue" : has('[data-testid="volume-bar"]') ? "volume" : has('[data-testid="pip-toggle-button"]') ? "pip" : has('[data-testid="fullscreen-mode-button"]') ? "full" : has('[aria-describedby="connect-message-nudge"]') || has('button[aria-label*="device" i]') ? "devices" : null;
        if (t && c.getAttribute("data-zune-tray") !== t) c.setAttribute("data-zune-tray", t);
      }
    }
    const lyrics = document.querySelector('[data-zune="lyrics-cell"] [style*="--lyrics-color-active"]');
    for (const old of document.querySelectorAll('[data-zune="lyrics"]')) if (old !== lyrics) untag(old, "lyrics");
    tag(lyrics, "lyrics");
    setClass("zune-lyrics-open", !!lyrics);
  }
  // Spotify replaces both the player shell and nested tray controls. Repair
  // the injected controls on the next frame, including a lost volume readout.
  // Ignore text updates so the playback clock doesn't cause extra mounts.
  const watched = new Map(); // node -> MutationObserver
  let mountFrame = 0;
  const watchChildren = (node, subtree = false) => {
    if (!node || !window.MutationObserver || watched.has(node)) return;
    for (const [old, mo] of watched) if (!old.isConnected) { mo.disconnect(); watched.delete(old); }
    const mo = new MutationObserver((records) => {
      if (mountFrame || !records.some((r) => [...r.addedNodes, ...r.removedNodes].some((n) => n.nodeType === 1))) return;
      mountFrame = requestAnimationFrame(() => {
        mountFrame = 0;
        mount();
      });
    });
    mo.observe(node, { childList: true, subtree });
    watched.set(node, mo);
  };
  // re-tag soon after things that swap Spotify's containers
  let tagTimers = [];
  function tagSoon() {
    tagTimers.forEach(clearTimeout);
    tagTimers = [0, 120, 400, 1000].map((ms) => setTimeout(tagDom, ms));
  }
  document.addEventListener(
    "click",
    (e) => {
      if (e.target?.closest?.('[data-testid="lyrics-button"], [data-testid="control-button-queue"], #Desktop_LeftSidebar_Id header button, [data-testid="cover-art-button"]')) tagSoon();
    },
    true
  );

  function mount() {
    const nav = document.getElementById("global-nav-bar");
    if (nav) {
      // Pivots go straight after the back/forward block, so Tab order
      // reads back, pivots, search, account.
      const left = nav.querySelector(":scope > div");
      if (left) {
        if (pivotEl.parentElement !== nav || pivotEl.previousElementSibling !== left) left.after(pivotEl);
      } else if (pivotEl.parentElement !== nav) nav.append(pivotEl);
      if (linksEl.parentElement !== nav) nav.append(linksEl);
      if (userEl.parentElement !== nav) nav.append(userEl);
    }
    const bar = $('aside[data-testid="now-playing-bar"] > div');
    if (bar) {
      for (const n of [fillA, fillB, npButton]) if (n.parentElement !== bar) bar.append(n);
      // Keep Spotify's slider and mute button where React owns them. Only
      // our readout is inserted beneath the slider, with a left-tray fallback.
      const volumeHost = bar.querySelector('[data-testid="volume-bar"]') || bar;
      if (volEl.parentElement !== volumeHost) {
        setVolPop(false);
        volumeHost.append(volEl);
      }
    }
    tagDom();
    watchChildren(nav?.parentElement);
    watchChildren(nav);
    watchChildren(bar?.parentElement?.parentElement);
    watchChildren(bar?.parentElement);
    watchChildren(bar, true);
    browser.syncCovered();
    const lib = document.getElementById("Desktop_LeftSidebar_Id");
    if (libObserver && lib && lib !== libObserved) {
      if (libObserved) libObserver.unobserve(libObserved);
      libObserver.observe(lib);
      libObserved = lib;
    }
  }

  // The app frame should never scroll; scrollIntoView and focus can nudge it.
  // The scroll event is enough: reading scrollTop elsewhere forces a layout.
  const unscroll = () => {
    const se = document.scrollingElement;
    if (se && se.scrollTop) se.scrollTop = 0;
  };
  window.addEventListener("scroll", unscroll, { passive: true });

  /* ------------------------------------------------------------------ */
  /* entrances: the pieces of a new page blur up as Spotify renders them  */
  /* ------------------------------------------------------------------ */
  const CURVES = { in: "cubic-bezier(0.42, 0, 1, 1)", out: "cubic-bezier(0, 0, 0.2, 1)", smooth: "cubic-bezier(0.42, 0, 0.58, 1)", linear: "linear" };
  function enterFrames() {
    const reduced = settings.motion === "reduced" || settings.enterStyle === "fade";
    if (reduced) return [{ offset: 0, opacity: 0 }];
    if (settings.enterStyle === "slide") return [{ offset: 0, opacity: 0, transform: "translate3d(42px, 0, 0)" }];
    return [{ offset: 0, opacity: 0, filter: `blur(${settings.enterBlur}px)`, transform: `translate3d(0, ${settings.enterRise}px, 0)` }];
  }
  const enterTiming = (i = 0) => ({
    duration: settings.slideDuration * 1000,
    easing: CURVES[settings.enterCurve] || CURVES.out,
    delay: Math.min(i, 6) * settings.enterStagger,
    fill: "backwards",
  });
  // Animate one element in from nothing. It ends on its own styles.
  function enter(el, i = 0) {
    if (settings.motion === "off" || !el?.animate) return null;
    try {
      return el.animate(enterFrames(), enterTiming(i));
    } catch (_) {
      return null;
    }
  }

  const pageEntrance = (() => {
    // the blocks that move, in reading order: header art and text, the play
    // row, column labels, track rows, cards, shortcuts, chips, section titles
    const PIECES = [
      ".main-entityHeader-imageContainer",
      ".main-entityHeader-headerText",
      '[data-testid="action-bar-row"]',
      ".main-trackList-trackListHeader",
      '[role="row"]',
      '[data-encore-id="card"]',
      ".view-homeShortcutsGrid-shortcut",
      '[data-encore-id="chip"]',
      '[data-testid="component-shelf"] > div:first-child',
      "h1",
      "h2",
    ].join(",");
    const WINDOW = 1800; // ms after a click in which new pieces animate
    const MAX = 60; // pieces per page
    let until = 0;
    let count = 0;
    let host = null;
    let seen = new WeakSet();
    // Mutation callbacks run before the browser paints, so a piece never
    // shows in place first and then jumps back to animate.
    let firstAt = 0;
    const observer = new MutationObserver((records) => {
      if (performance.now() > until || count >= MAX) return stop();
      // the first batch staggers; anything that arrives later just comes in
      const late = firstAt && performance.now() - firstAt > 250;
      const found = [];
      for (const r of records) {
        for (const node of r.addedNodes) {
          if (node.nodeType !== 1 || !node.isConnected) continue;
          if (node.matches(PIECES)) found.push(node);
          for (const el of node.querySelectorAll(PIECES)) found.push(el);
        }
      }
      let i = 0;
      for (const el of found) {
        if (count >= MAX) break;
        if (seen.has(el)) continue;
        // a piece inside one that is already moving moves with it
        let up = el.parentElement;
        while (up && up !== host && !seen.has(up)) up = up.parentElement;
        if (up && up !== host) continue;
        seen.add(el);
        count++;
        if (!firstAt) firstAt = performance.now();
        enter(el, late ? 0 : i++);
      }
    });
    function stop() {
      observer.disconnect();
      until = 0;
    }
    function start() {
      stop();
      if (settings.motion === "off" || !settings.pageEntrances) return;
      // a Zoone page covers Spotify's: it animates itself
      if (["zune-browsing", "zune-qp-shown", "zune-social-shown", "zune-browse-shown"].some((c) => root.classList.contains(c))) return;
      host = document.getElementById("main-view");
      if (!host) return;
      until = performance.now() + WINDOW;
      firstAt = 0;
      count = 0;
      seen = new WeakSet();
      observer.observe(host, { childList: true, subtree: true });
      setTimeout(() => performance.now() > until && stop(), WINDOW + 50);
    }
    return { start };
  })();

  // A new song: the cover and title in the player bar and the now playing
  // panel blur up once Spotify shows them.
  const songEntrance = (() => {
    let until = 0;
    let done = new WeakSet();
    const observer = new MutationObserver((records) => {
      if (performance.now() > until) return observer.disconnect();
      for (const r of records) {
        const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        const piece = el?.closest?.('[data-testid="cover-art-container"], [data-testid="context-item-info-title"], [data-testid="context-item-info-subtitles"], [data-zune="np-widget"] img, #Desktop_PanelContainer_Id img');
        if (!piece || done.has(piece)) continue;
        done.add(piece);
        enter(piece, done.size);
      }
    });
    return {
      start() {
        observer.disconnect();
        if (settings.motion === "off") return;
        until = performance.now() + 1500;
        done = new WeakSet();
        for (const sel of ['[data-zune="np-widget"]', "#Desktop_PanelContainer_Id"]) {
          const node = document.querySelector(sel);
          if (node) observer.observe(node, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["src"] });
        }
        setTimeout(() => observer.disconnect(), 1600);
      },
    };
  })();

  function onRoute(pathname) {
    const p = pathname || "/";
    // Spotify's Home becomes Zune's quickplay (Settings > quickplay)
    if (p === "/" && settings.quickplayView === "zune") {
      History.replace(QP_PATH);
      return;
    }
    renderPivots(p);
    updateQuickplay(p);
    mount();
    tagSoon();
    setClass("zune-route-browse", p === "/search");
    setClass("zune-route-apps", p.startsWith("/marketplace"));
    browser.show(p === BROWSER_PATH);
    quickplay.show(p === QP_PATH);
    social.show(p === SOCIAL_PATH);
    browse.show(p === BROWSE_PATH);
    if (p.startsWith("/collection") || p === BROWSER_PATH) updateCount();
    pageEntrance.start();
  }

  History.listen((loc) => {
    menu.close();
    onRoute(loc?.pathname);
  });
  S.Player.addEventListener("songchange", () => {
    songEntrance.start();
    tagSoon(); // a Canvas video may come or go
    updatePlaying();
    mix.onSongChange();
    browser.onSongChange();
    social.onSongChange();
    djMix.onSongChange();
  });
  S.Player.addEventListener("onplaypause", () => {
    updatePlaying();
    mix.onPlayPause();
    browser.onPlayerUpdate();
  });
  S.Player.addEventListener("onprogress", () => {
    if (mix.isOpen) mix.onProgress();
  });

  setInterval(() => {
    if (document.hidden) return; // nothing to see; onRoute still mounts on navigation
    mount();
    renderVolume();
    browser.onPlayerUpdate();
  }, 1000);
  setInterval(() => !document.hidden && updateCount(true), 120000);

  for (const type of ["pointermove", "pointerdown", "wheel", "touchstart"]) {
    window.addEventListener(type, noteActivity, { capture: true, passive: true });
  }
  document.addEventListener("visibilitychange", () => {
    setVolPop(false);
    if (!document.hidden) {
      lastInput = Date.now();
      mount();
      renderVolume(true);
    }
  });
  setInterval(() => {
    if (document.hidden || !settings.idleNowPlaying || mix.isOpen || overlays.length) return;
    if (!S.Player.data?.item) return;
    if (settings.idleOnlyPlaying && !S.Player.isPlaying?.()) return;
    if (Date.now() - lastInput < settings.idleMinutes * 60000) return;
    mix.open();
    idleOpened = true;
  }, 5000);

  try {
    new S.Menu.Item("Zoone settings", false, () => settingsPage.open()).register();
  } catch (_) {
    /* menu API not available */
  }

  applyEverything();
  onRoute(currentPath());
  updatePlaying();
  booted = true;
  // "match system" follows macOS switching between light and dark
  try {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (settings.appearance === "system") applyScheme(true);
    });
  } catch (_) {
    /* no media query support */
  }
  setTimeout(() => mix.preload(), 4000);

  window.ZuneTheme = {
    version: "0.0.5",
    openSettings: (cat) => settingsPage.open(cat),
    closeSettings: () => settingsPage.close(),
    openNowPlaying: () => mix.open(),
    openCollection: () => History.push(BROWSER_PATH),
    _browser: browser,
    _dj: djMix,
    _heart: heart,
    _idle: { get lastInput() { return lastInput; }, set lastInput(v) { lastInput = v; }, get opened() { return idleOpened; } },
    closeNowPlaying: () => mix.close(),
    get settings() {
      return { ...settings };
    },
  };
})();
