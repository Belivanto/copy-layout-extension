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
    "box-shadow", "cursor", "white-space", "vertical-align", "object-fit",
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

  function styleString(el) {
    const computed = getComputedStyle(el);
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
      const placeholder = document.createElement("div");
      placeholder.setAttribute(
        "style",
        `${styleString(el)}; background-color: #ffffff; display: flex; align-items: center; justify-content: center; overflow: hidden; color: #999999; font-size: 12px; font-family: sans-serif;`
      );
      placeholder.textContent = "picture";
      return placeholder;
    }

    const clone = document.createElement(el.tagName.toLowerCase());
    clone.setAttribute("style", styleString(el));

    if (el.tagName === "IMG") {
      clone.setAttribute("src", el.src);
      if (el.alt) clone.setAttribute("alt", el.alt);
    } else if (el.tagName === "SVG" || el instanceof SVGElement) {
      return el.cloneNode(true);
    } else {
      for (const child of el.childNodes) {
        const clonedChild = cloneNode(child);
        if (clonedChild) clone.appendChild(clonedChild);
      }
    }

    return clone;
  }

  const bodyClone = cloneNode(document.body);
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${document.title} (layout copy)</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; }
</style>
</head>
${bodyClone.outerHTML}
</html>`;

  return html;
}
