// Injected into the page via chrome.scripting.executeScript.
// Walks the live DOM and produces a standalone HTML document that
// reproduces the page's current layout by inlining computed styles.
function captureLayout(options = {}) {
  const excludeImages = !!options.excludeImages;
  const LAYOUT_PROPS = [
    "display", "position", "top", "right", "bottom", "left", "float", "clear",
    "box-sizing", "width", "height", "min-width", "min-height", "max-width", "max-height",
    "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
    "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
    "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
    "border-top-left-radius", "border-top-right-radius", "border-bottom-left-radius", "border-bottom-right-radius",
    "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis",
    "justify-content", "align-items", "align-self", "align-content", "order", "gap", "row-gap", "column-gap",
    "grid-template-columns", "grid-template-rows", "grid-column", "grid-row", "grid-auto-flow",
    "overflow", "overflow-x", "overflow-y", "z-index", "visibility", "opacity",
    "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align", "text-decoration",
    "color", "background-color", "background-image", "background-size", "background-position", "background-repeat",
    "box-shadow", "cursor", "white-space", "vertical-align", "object-fit", "object-position",
    "transform", "transform-origin", "filter", "backdrop-filter",
    "mix-blend-mode", "background-blend-mode", "background-attachment", "clip-path", "aspect-ratio",
  ];

  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "LINK", "META", "TITLE"]);

  function resolveUrlsInValue(value) {
    return value.replace(/url\((['"]?)(.*?)\1\)/g, (match, quote, url) => {
      if (/^(data:|https?:)/.test(url)) return match;
      try {
        return `url("${new URL(url, document.baseURI).href}")`;
      } catch {
        return match;
      }
    });
  }

  function styleStringFromComputed(computed) {
    const parts = [];
    let hadImageBackground = false;
    for (const prop of LAYOUT_PROPS) {
      const value = computed.getPropertyValue(prop);
      if (!value) continue;
      if (excludeImages && prop === "background-image" && /url\(/.test(value)) {
        hadImageBackground = true;
        continue;
      }
      parts.push(`${prop}: ${resolveUrlsInValue(value)}`);
    }
    if (hadImageBackground) {
      parts.push("background-color: #ffffff");
    }
    return parts.join("; ");
  }

  function styleString(el) {
    return styleStringFromComputed(getComputedStyle(el));
  }

  // Decorative overlays (gradients, icon glyphs, shapes) are very often drawn
  // via ::before/::after rather than real DOM nodes, so a DOM-only walk misses
  // them entirely. Re-create them as real elements carrying the same styles.
  function makePseudoElement(el, pseudo) {
    const computed = getComputedStyle(el, `::${pseudo}`);
    if (!computed || computed.content === "none" || computed.display === "none") return null;

    const span = document.createElement("span");
    span.setAttribute("style", styleStringFromComputed(computed));

    const stringMatch = /^["'](.*)["']$/.exec(computed.content);
    if (stringMatch) {
      span.textContent = stringMatch[1];
    }
    return span;
  }

  // Plain HTML has no notion of shadow DOM, so a custom element's real
  // rendered content (inside its shadow root) has to be flattened into the
  // light DOM here — otherwise it's just an empty tag in the output. A
  // closed shadow root (el.shadowRoot === null) can't be read from outside
  // at all; that's a hard JS/platform limitation, not something to work around.
  function appendResolvedChild(parentClone, node) {
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "SLOT") {
      const assigned = node.assignedNodes ? node.assignedNodes({ flatten: true }) : [];
      const projected = assigned.length ? assigned : node.childNodes; // fall back to <slot> default content
      for (const projectedNode of projected) {
        appendResolvedChild(parentClone, projectedNode);
      }
      return;
    }
    const clonedChild = cloneNode(node);
    if (clonedChild) parentClone.appendChild(clonedChild);
  }

  function cloneChildrenInto(clone, el) {
    const source = el.shadowRoot || el;
    for (const child of source.childNodes) {
      appendResolvedChild(clone, child);
    }
  }

  function makeImagePlaceholder(el) {
    const placeholder = document.createElement("div");
    placeholder.setAttribute(
      "style",
      `${styleString(el)}; background-color: #ffffff; display: flex; align-items: center; justify-content: center; overflow: hidden; color: #999999; font-size: 12px; font-family: sans-serif;`
    );
    placeholder.textContent = "picture";
    return placeholder;
  }

  function cloneNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const el = node;
    if (SKIP_TAGS.has(el.tagName)) return null;

    const computed = getComputedStyle(el);
    if (computed.display === "none") return null;

    if (el.tagName === "IMG" && excludeImages) {
      return makeImagePlaceholder(el);
    }

    if (el.tagName === "CANVAS") {
      if (excludeImages) return makeImagePlaceholder(el);
      const img = document.createElement("img");
      img.setAttribute("style", styleString(el));
      try {
        // Rendered pixels only exist on the canvas itself, never in the DOM,
        // so this is the only way to carry them into a static HTML export.
        img.setAttribute("src", el.toDataURL());
      } catch {
        // Cross-origin drawing "taints" the canvas and blocks pixel reads
        // entirely — no way around that, so fall back to a placeholder.
        return makeImagePlaceholder(el);
      }
      return img;
    }

    const clone = document.createElement(el.tagName.toLowerCase());
    clone.setAttribute("style", styleString(el));

    if (el.tagName === "IMG") {
      clone.setAttribute("src", el.src);
      if (el.alt) clone.setAttribute("alt", el.alt);
    } else if (el.tagName === "SVG" || el instanceof SVGElement) {
      return el.cloneNode(true);
    } else {
      const beforeEl = makePseudoElement(el, "before");
      if (beforeEl) clone.appendChild(beforeEl);

      cloneChildrenInto(clone, el);

      const afterEl = makePseudoElement(el, "after");
      if (afterEl) clone.appendChild(afterEl);
    }

    return clone;
  }

  // Computed styles only ever report a font-family *name* — the actual font
  // files come from @font-face rules or <link> stylesheets (e.g. Google
  // Fonts), which live in <head> and are otherwise never carried over. Without
  // them the exported page silently falls back to a generic system font.
  function collectFontStyles() {
    const headExtras = [];
    const fontFaceCssParts = [];

    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        // Cross-origin stylesheet we can't inspect from script (most of these
        // are font providers like Google Fonts) — just re-link it so the
        // browser fetches it normally when the exported page is opened.
        if (sheet.href) {
          headExtras.push(`<link rel="stylesheet" href="${sheet.href}">`);
        }
        continue;
      }
      if (!rules) continue;
      for (const rule of rules) {
        if (rule.type === CSSRule.FONT_FACE_RULE) {
          const base = sheet.href || document.baseURI;
          const cssText = rule.cssText.replace(/url\((['"]?)(.*?)\1\)/g, (match, quote, url) => {
            if (/^(data:|https?:)/.test(url)) return match;
            try {
              return `url("${new URL(url, base).href}")`;
            } catch {
              return match;
            }
          });
          fontFaceCssParts.push(cssText);
        }
      }
    }

    if (fontFaceCssParts.length) {
      headExtras.push(`<style>${fontFaceCssParts.join("\n")}</style>`);
    }
    return headExtras.join("\n");
  }

  const bodyClone = cloneNode(options.root || document.body);
  const fontStyles = collectFontStyles();
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${document.title} (layout copy)</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; }
</style>
${fontStyles}
</head>
${bodyClone.outerHTML}
</html>`;

  return html;
}

// Wraps a captured layout in an instruction template so it can be pasted
// straight into an AI chat and asked to rebuild the page, instead of just
// handing over the raw standalone HTML.
function buildLayoutPrompt(html, pageTitle, lang) {
  if (lang === "en") {
    return `You are a frontend developer. Recreate this webpage using HTML and CSS, keeping the structure, layout, colors, fonts, and spacing as close to the original as possible (organize the code well, e.g. use classes instead of inline styles where feasible). If you see a white box with the text "picture", treat it as a spot where an image was removed and insert a placeholder image there instead.

Here is the original layout (title: "${pageTitle}"):

\`\`\`html
${html}
\`\`\``;
  }
  return `คุณคือ Frontend Developer ช่วยสร้างหน้าเว็บนี้ขึ้นมาใหม่โดยใช้ HTML และ CSS ให้มีโครงสร้าง การจัดวาง สี ฟอนต์ และระยะห่างใกล้เคียงต้นฉบับมากที่สุด (จัดโค้ดให้เป็นระเบียบ เช่น แยก CSS เป็น class แทน inline style ถ้าเป็นไปได้) หากพบกล่องสีขาวที่มีข้อความ "picture" ให้เข้าใจว่าเป็นตำแหน่งรูปภาพที่ถูกเอาออกไป ให้ใส่ placeholder image แทนที่ตำแหน่งนั้น

นี่คือ layout ต้นฉบับ (title: "${pageTitle}"):

\`\`\`html
${html}
\`\`\``;
}

// Lets the user click an element on the page to capture just that subtree
// instead of the whole body. Runs entirely in the page context so the
// resulting clipboard write/download still counts as triggered by the same
// user click (the popup itself closes as soon as the page is clicked).
function startElementPicker(options = {}) {
  if (window.__copyLayoutPickerActive) return;
  window.__copyLayoutPickerActive = true;

  const PICKER_STRINGS = {
    th: {
      banner: "คลิกเลือก element ที่ต้องการ copy layout (กด Esc เพื่อยกเลิก)",
      downloaded: "ดาวน์โหลด layout ของ element แล้ว",
      copied: "คัดลอก layout ของ element แล้ว",
      copyFailed: (msg) => `คัดลอกไม่สำเร็จ: ${msg}`,
    },
    en: {
      banner: "Click the element you want to copy the layout of (press Esc to cancel)",
      downloaded: "Downloaded the element's layout",
      copied: "Copied the element's layout",
      copyFailed: (msg) => `Copy failed: ${msg}`,
    },
  };
  const s = PICKER_STRINGS[options.lang] || PICKER_STRINGS.th;

  const Z = 2147483647;
  const overlay = document.createElement("div");
  overlay.style.cssText = `position:fixed;display:none;pointer-events:none;z-index:${Z};border:2px solid #4f46e5;background:rgba(79,70,229,0.15);`;
  document.documentElement.appendChild(overlay);

  const banner = document.createElement("div");
  banner.textContent = s.banner;
  banner.style.cssText = `position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:${Z};background:#1a1a1a;color:#fff;padding:8px 14px;border-radius:6px;font:13px sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3);`;
  document.documentElement.appendChild(banner);

  function showToast(message) {
    const toast = document.createElement("div");
    toast.textContent = message;
    toast.style.cssText = `position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:${Z};background:#16a34a;color:#fff;padding:8px 14px;border-radius:6px;font:13px sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3);`;
    document.documentElement.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  let currentTarget = null;

  function onMouseMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === currentTarget || el === overlay || el === banner) return;
    currentTarget = el;
    const rect = el.getBoundingClientRect();
    overlay.style.display = "block";
    overlay.style.top = `${rect.top}px`;
    overlay.style.left = `${rect.left}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
  }

  function cleanup() {
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    overlay.remove();
    banner.remove();
    window.__copyLayoutPickerActive = false;
  }

  async function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const target = currentTarget || e.target;
    cleanup();

    const rawHtml = captureLayout({ excludeImages: options.excludeImages, root: target });
    const output = options.promptMode ? buildLayoutPrompt(rawHtml, document.title, options.lang) : rawHtml;

    if (options.action === "download") {
      const blob = new Blob([output], { type: options.promptMode ? "text/plain" : "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = options.promptMode ? "element-layout-prompt.txt" : "element-layout.html";
      a.click();
      URL.revokeObjectURL(url);
      showToast(s.downloaded);
    } else {
      try {
        await navigator.clipboard.writeText(output);
        showToast(s.copied);
      } catch (err) {
        showToast(s.copyFailed(err.message));
      }
    }
  }

  function onKeyDown(e) {
    if (e.key === "Escape") cleanup();
  }

  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
}
