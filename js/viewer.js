// viewer.js — case picker + otoscopy scope view

let libraryIndex = null;

async function init() {
  const params = new URLSearchParams(window.location.search);
  const caseId = params.get("case");

  const [caseIndex, library] = await Promise.all([
    Api.getCaseIndex(),
    Api.getLibraryIndex(),
  ]);
  libraryIndex = library;

  if (caseId) {
    await showCase(caseId);
  } else {
    showPicker(caseIndex);
  }
}

function showPicker(caseIndex) {
  document.getElementById("picker-view").classList.remove("hidden");
  document.getElementById("case-view").classList.add("hidden");

  const grid = document.getElementById("case-grid");
  grid.innerHTML = "";
  caseIndex.cases.forEach((c) => {
    const card = document.createElement("button");
    card.className = "case-card";
    card.innerHTML = `
      <h3>${escapeHtml(c.title)}</h3>
      <span class="diff">${escapeHtml(c.difficulty)}</span>
    `;
    card.addEventListener("click", () => {
      const url = new URL(window.location.href);
      url.searchParams.set("case", c.id);
      window.location.href = url.toString();
    });
    grid.appendChild(card);
  });
}

async function showCase(caseId) {
  document.getElementById("picker-view").classList.add("hidden");
  document.getElementById("case-view").classList.remove("hidden");

  let caseData;
  try {
    caseData = await Api.getCase(caseId);
  } catch (err) {
    document.getElementById("case-view").innerHTML = `
      <p>Couldn't load this case (${escapeHtml(caseId)}). It may have been
      removed, or the link is incorrect.</p>
      <a class="btn" href="index.html">Back to case list</a>
    `;
    return;
  }

  document.getElementById("case-title").textContent = caseData.title;
  document.getElementById("case-description").textContent = caseData.description || "";

  const left = findImage(caseData.leftImageId);
  const right = findImage(caseData.rightImageId);
  document.getElementById("left-img").src = left ? left.path : "";
  document.getElementById("left-img").alt = "Left ear otoscopy view";
  document.getElementById("right-img").src = right ? right.path : "";
  document.getElementById("right-img").alt = "Right ear otoscopy view";

  document.getElementById("findings-text").textContent = caseData.findings || "";
  document.getElementById("findings").classList.add("hidden");
  document.getElementById("reveal-btn").classList.toggle("hidden", !caseData.findings);

  const shareUrl = new URL(window.location.href);
  shareUrl.searchParams.set("case", caseId);
  document.getElementById("share-url").value = shareUrl.toString();
}

function findImage(imageId) {
  if (!libraryIndex) return null;
  return libraryIndex.images.find((img) => img.id === imageId) || null;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// Wires a floating, draggable landmark guide panel (toggle button, close
// button, and drag-by-the-bar) for one ear ("left" or "right"). The panel
// starts positioned beside its otoscope frame, then stays wherever the
// student last dragged it for the rest of the session.
function setupGuidePanel(side) {
  const toggle = document.getElementById(`${side}-guide-toggle`);
  const panel = document.getElementById(`${side}-guide-panel`);
  const bar = document.getElementById(`${side}-guide-bar`);
  const closeBtn = document.getElementById(`${side}-guide-close`);
  const frame = document.getElementById(`${side}-scope-frame`);
  if (!toggle || !panel || !bar || !frame) return;

  let positioned = false;

  function placeNearFrame() {
    const frameRect = frame.getBoundingClientRect();
    const panelWidth = panel.offsetWidth || 420;
    const margin = 20;
    let left = side === "left"
      ? frameRect.right + margin
      : frameRect.left - panelWidth - margin;
    left = Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8));
    const top = Math.max(8, frameRect.top);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    positioned = true;
  }

  function openPanel() {
    if (!positioned) placeNearFrame();
    panel.classList.add("open");
  }

  function closePanel() {
    panel.classList.remove("open");
  }

  toggle.addEventListener("click", () => {
    panel.classList.contains("open") ? closePanel() : openPanel();
  });
  closeBtn?.addEventListener("click", closePanel);

  let dragOffsetX = 0;
  let dragOffsetY = 0;

  function onDragMove(e) {
    const x = Math.max(0, Math.min(e.clientX - dragOffsetX, window.innerWidth - 40));
    const y = Math.max(0, Math.min(e.clientY - dragOffsetY, window.innerHeight - 40));
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
  }

  function onDragEnd() {
    document.removeEventListener("pointermove", onDragMove);
    document.removeEventListener("pointerup", onDragEnd);
  }

  bar.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".guide-close-btn")) return;
    const rect = panel.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    document.addEventListener("pointermove", onDragMove);
    document.addEventListener("pointerup", onDragEnd);
    e.preventDefault();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  init();

  document.getElementById("reveal-btn")?.addEventListener("click", () => {
    document.getElementById("findings").classList.remove("hidden");
    document.getElementById("reveal-btn").classList.add("hidden");
  });

  setupGuidePanel("right");
  setupGuidePanel("left");

  document.getElementById("copy-share-btn")?.addEventListener("click", async () => {
    const input = document.getElementById("share-url");
    input.select();
    try {
      await navigator.clipboard.writeText(input.value);
      const status = document.getElementById("share-status");
      status.textContent = "Link copied";
      setTimeout(() => (status.textContent = ""), 1800);
    } catch {
      /* clipboard API unavailable — selection still lets the user Ctrl+C */
    }
  });
});
