const copyBtn = document.getElementById("copyBtn");
const promptBtn = document.getElementById("promptBtn");
const downloadBtn = document.getElementById("downloadBtn");
const excludeImagesCheckbox = document.getElementById("excludeImages");
const pickElementCheckbox = document.getElementById("pickElement");
const includeHtmlCheckbox = document.getElementById("includeHtml");
const statusEl = document.getElementById("status");
const subtitleEl = document.getElementById("subtitle");
const excludeImagesLabel = document.getElementById("excludeImagesLabel");
const pickElementLabel = document.getElementById("pickElementLabel");
const includeHtmlLabel = document.getElementById("includeHtmlLabel");
const langThBtn = document.getElementById("langTh");
const langEnBtn = document.getElementById("langEn");

const STRINGS = {
  th: {
    subtitle: "จับโครงสร้างและสไตล์ของหน้าเว็บที่กำลังดูอยู่",
    excludeImages: "ไม่รวมรูปภาพ (แทนที่ด้วยกล่องสีขาว)",
    pickElement: "เลือกเฉพาะ element (คลิกบนหน้าเว็บ)",
    includeHtml: "แนบ Layout HTML ไปกับ Prompt ด้วย",
    copyBtn: "คัดลอก Layout",
    promptBtn: "คัดลอก Prompt",
    downloadBtn: "ดาวน์โหลด HTML",
    cantCapture: "ไม่สามารถจับภาพหน้านี้ได้",
    capturing: "กำลังจับภาพ layout…",
    analyzing: "กำลังวิเคราะห์ layout…",
    pickPrompt: "คลิกที่ element บนหน้าเว็บที่ต้องการ…",
    copied: "คัดลอก layout ไปยังคลิปบอร์ดแล้ว!",
    promptCopied: "คัดลอก Prompt แล้ว!",
    downloaded: "ดาวน์โหลด layout แล้ว!",
    failed: "จับภาพ layout ไม่สำเร็จ",
  },
  en: {
    subtitle: "Capture the current page's structure & styles",
    excludeImages: "Exclude images (replace with white boxes)",
    pickElement: "Pick a specific element (click on the page)",
    includeHtml: "Attach layout HTML to the prompt too",
    copyBtn: "Copy Layout",
    promptBtn: "Copy Prompt",
    downloadBtn: "Download HTML",
    cantCapture: "This page can't be captured.",
    capturing: "Capturing layout…",
    analyzing: "Analyzing layout…",
    pickPrompt: "Click the element on the page you want…",
    copied: "Layout copied to clipboard!",
    promptCopied: "Prompt copied to clipboard!",
    downloaded: "Layout downloaded!",
    failed: "Failed to capture layout.",
  },
};

let lang = localStorage.getItem("copyLayoutLang") || "th";

function t(key) {
  return STRINGS[lang][key];
}

function applyLanguage() {
  document.documentElement.lang = lang;
  subtitleEl.textContent = t("subtitle");
  excludeImagesLabel.textContent = t("excludeImages");
  pickElementLabel.textContent = t("pickElement");
  includeHtmlLabel.textContent = t("includeHtml");
  copyBtn.textContent = t("copyBtn");
  promptBtn.textContent = t("promptBtn");
  downloadBtn.textContent = t("downloadBtn");
  langThBtn.classList.toggle("active", lang === "th");
  langEnBtn.classList.toggle("active", lang === "en");
}

function setLang(newLang) {
  if (newLang === lang) return;
  lang = newLang;
  localStorage.setItem("copyLayoutLang", lang);
  applyLanguage();
}

langThBtn.addEventListener("click", () => setLang("th"));
langEnBtn.addEventListener("click", () => setLang("en"));

applyLanguage();

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = `status ${type || ""}`;
}

function setBusy(busy) {
  copyBtn.disabled = busy;
  promptBtn.disabled = busy;
  downloadBtn.disabled = busy;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureCapturableTab() {
  const tab = await getActiveTab();
  if (!tab || !tab.id || !/^https?:/.test(tab.url || "")) {
    throw new Error(t("cantCapture"));
  }
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content.js"],
  });
  return tab;
}

async function captureCurrentTab() {
  const tab = await ensureCapturableTab();
  const options = { excludeImages: excludeImagesCheckbox.checked };
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (opts) => captureLayout(opts),
    args: [options],
  });
  return { html: result, title: tab.title || "page" };
}

async function capturePromptForCurrentTab() {
  const tab = await ensureCapturableTab();
  const options = { excludeImages: excludeImagesCheckbox.checked };
  const includeHtml = includeHtmlCheckbox.checked;
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (opts, withHtml) => {
      const analysis = analyzeLayout(document.body);
      const html = withHtml ? captureLayout(opts) : null;
      return buildStructuredPrompt(analysis, html);
    },
    args: [options, includeHtml],
  });
  return result;
}

// Runs the picker in the page itself: the user clicks an element there, and
// the picker performs the copy/download right at that click (the popup will
// already be closed by the time they click the page).
async function startPicker(action) {
  const tab = await ensureCapturableTab();
  const options = {
    excludeImages: excludeImagesCheckbox.checked,
    includeHtml: includeHtmlCheckbox.checked,
    lang,
    action,
  };
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (opts) => startElementPicker(opts),
    args: [options],
  });
}

copyBtn.addEventListener("click", async () => {
  setBusy(true);
  try {
    if (pickElementCheckbox.checked) {
      setStatus(t("pickPrompt"));
      await startPicker("copy");
    } else {
      setStatus(t("capturing"));
      const { html } = await captureCurrentTab();
      await navigator.clipboard.writeText(html);
      setStatus(t("copied"), "success");
    }
  } catch (err) {
    setStatus(err.message || t("failed"), "error");
  } finally {
    setBusy(false);
  }
});

promptBtn.addEventListener("click", async () => {
  setBusy(true);
  try {
    if (pickElementCheckbox.checked) {
      setStatus(t("pickPrompt"));
      await startPicker("prompt");
    } else {
      setStatus(t("analyzing"));
      const prompt = await capturePromptForCurrentTab();
      await navigator.clipboard.writeText(prompt);
      setStatus(t("promptCopied"), "success");
    }
  } catch (err) {
    setStatus(err.message || t("failed"), "error");
  } finally {
    setBusy(false);
  }
});

downloadBtn.addEventListener("click", async () => {
  setBusy(true);
  try {
    if (pickElementCheckbox.checked) {
      setStatus(t("pickPrompt"));
      await startPicker("download");
    } else {
      setStatus(t("capturing"));
      const { html, title } = await captureCurrentTab();
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const filename = `${title.replace(/[^a-z0-9-_]+/gi, "-").slice(0, 60) || "layout"}.html`;
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setStatus(t("downloaded"), "success");
    }
  } catch (err) {
    setStatus(err.message || t("failed"), "error");
  } finally {
    setBusy(false);
  }
});
