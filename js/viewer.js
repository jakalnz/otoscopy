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

document.addEventListener("DOMContentLoaded", () => {
  init();

  document.getElementById("reveal-btn")?.addEventListener("click", () => {
    document.getElementById("findings").classList.remove("hidden");
    document.getElementById("reveal-btn").classList.add("hidden");
  });

  document.getElementById("right-guide-toggle")?.addEventListener("click", () => {
    document.getElementById("right-guide-panel").classList.toggle("open");
  });
  document.getElementById("left-guide-toggle")?.addEventListener("click", () => {
    document.getElementById("left-guide-panel").classList.toggle("open");
  });

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
