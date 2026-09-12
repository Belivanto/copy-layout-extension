const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");
const excludeImagesCheckbox = document.getElementById("excludeImages");
const statusEl = document.getElementById("status");

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = `status ${type || ""}`;
}

function setBusy(busy) {
  copyBtn.disabled = busy;
  downloadBtn.disabled = busy;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function captureCurrentTab() {
  const tab = await getActiveTab();
  if (!tab || !tab.id || !/^https?:/.test(tab.url || "")) {
    throw new Error("This page can't be captured.");
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content.js"],
  });

  const options = { excludeImages: excludeImagesCheckbox.checked };
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (opts) => captureLayout(opts),
    args: [options],
  });

  return { html: result, title: tab.title || "page" };
}

copyBtn.addEventListener("click", async () => {
  setBusy(true);
  setStatus("Capturing layout…");
  try {
    const { html } = await captureCurrentTab();
    await navigator.clipboard.writeText(html);
    setStatus("Layout copied to clipboard!", "success");
  } catch (err) {
    setStatus(err.message || "Failed to capture layout.", "error");
  } finally {
    setBusy(false);
  }
});

downloadBtn.addEventListener("click", async () => {
  setBusy(true);
  setStatus("Capturing layout…");
  try {
    const { html, title } = await captureCurrentTab();
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const filename = `${title.replace(/[^a-z0-9-_]+/gi, "-").slice(0, 60) || "layout"}.html`;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setStatus("Layout downloaded!", "success");
  } catch (err) {
    setStatus(err.message || "Failed to capture layout.", "error");
  } finally {
    setBusy(false);
  }
});
