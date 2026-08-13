// admin.js — supervisor case builder
//
// Auth model: a shared password is kept only in sessionStorage and sent as
// a header on each Worker request. The Worker is what actually holds the
// GitHub token and verifies the password — this page never touches a
// GitHub credential. See /worker/worker.js.

const state = {
  password: sessionStorage.getItem("otoscopy_admin_pw") || null,
  library: null,
  caseIndex: null,
  selection: { left: null, right: null }, // { mode: 'library'|'upload', imageId? , file? }
  tagFilter: { left: new Set(), right: new Set() },
  searchText: { left: "", right: "" },
  editingCaseId: null,
};

async function boot() {
  if (state.password) {
    await enterAdmin();
  }
  document.getElementById("gate-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = document.getElementById("gate-password").value.trim();
    if (!pw) return;
    state.password = pw;
    sessionStorage.setItem("otoscopy_admin_pw", pw);
    await enterAdmin();
  });
}

async function enterAdmin() {
  document.getElementById("gate").classList.add("hidden");
  document.getElementById("admin-main").classList.remove("hidden");

  try {
    const [library, caseIndex] = await Promise.all([
      Api.getLibraryIndex(),
      Api.getCaseIndex(),
    ]);
    state.library = library;
    state.caseIndex = caseIndex;
    renderPickers();
    renderCaseList();
    renderLibraryManage();
  } catch (err) {
    setStatus("case-status", "Couldn't load library or case data: " + err.message, "err");
  }
}

function renderCaseList() {
  const wrap = document.getElementById("case-list-admin");
  wrap.innerHTML = "";
  state.caseIndex.cases.forEach((c) => {
    const row = document.createElement("div");
    row.className = "case-row";
    const shareUrl = new URL("index.html", window.location.href);
    shareUrl.searchParams.set("case", c.id);
    row.innerHTML = `
      <div>
        <div>${escapeHtml(c.title)}</div>
        <div class="id">${escapeHtml(c.id)}</div>
      </div>
      <div class="case-row-actions">
        <a class="btn secondary" href="${shareUrl.toString()}" target="_blank">Open</a>
        <button type="button" class="secondary" data-edit="${escapeHtml(c.id)}">Edit</button>
        <button type="button" class="secondary" data-delete="${escapeHtml(c.id)}">Delete</button>
      </div>
    `;
    wrap.appendChild(row);
  });

  wrap.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => startEditCase(btn.dataset.edit));
  });
  wrap.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteCase(btn.dataset.delete));
  });
}

async function startEditCase(caseId) {
  setStatus("case-status", "Loading case…", "");
  try {
    const caseData = await Api.getCase(caseId);
    state.editingCaseId = caseId;

    document.getElementById("case-title-input").value = caseData.title || "";
    document.getElementById("case-difficulty-input").value = caseData.difficulty || "beginner";
    document.getElementById("case-desc-input").value = caseData.description || "";
    document.getElementById("case-findings-input").value = caseData.findings || "";

    state.selection.left = caseData.leftImageId ? { mode: "library", imageId: caseData.leftImageId } : null;
    state.selection.right = caseData.rightImageId ? { mode: "library", imageId: caseData.rightImageId } : null;
    renderPickers();

    document.getElementById("case-submit-btn").textContent = "Save changes";
    document.getElementById("case-cancel-edit-btn").classList.remove("hidden");
    setStatus("case-status", `Editing "${caseData.title}".`, "ok");
    document.getElementById("case-form").scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    setStatus("case-status", `Couldn't load case: ${err.message}`, "err");
  }
}

function cancelEditCase() {
  state.editingCaseId = null;
  document.getElementById("case-form").reset();
  state.selection = { left: null, right: null };
  renderPickers();
  document.getElementById("case-submit-btn").textContent = "Create case";
  document.getElementById("case-cancel-edit-btn").classList.add("hidden");
}

async function handleDeleteCase(caseId) {
  const c = state.caseIndex.cases.find((x) => x.id === caseId);
  if (!confirm(`Delete case "${c ? c.title : caseId}"? This can't be undone.`)) return;

  setStatus("case-status", "Deleting case…", "");
  try {
    await Api.deleteCase(state.password, caseId);
    state.caseIndex.cases = state.caseIndex.cases.filter((x) => x.id !== caseId);
    renderCaseList();
    if (state.editingCaseId === caseId) cancelEditCase();
    setStatus("case-status", "Case deleted.", "ok");
  } catch (err) {
    setStatus("case-status", `Couldn't delete case: ${err.message}`, "err");
  }
}

// ---------- image library management ----------

function renderLibraryManage() {
  const grid = document.getElementById("library-manage-grid");
  grid.innerHTML = "";
  state.library.images.forEach((img) => {
    const item = document.createElement("div");
    item.className = "library-manage-item";
    item.innerHTML = `
      <div class="scope-frame thumb"><img src="${img.path}" alt="${escapeHtml(img.tags.join(', '))}" /></div>
      <div class="tags">${escapeHtml(img.ear)}${img.tags.length ? " · " + escapeHtml(img.tags.map((t) => "#" + t).join(" ")) : ""}</div>
      <button type="button" class="secondary delete-btn" data-delete-image="${escapeHtml(img.id)}">Delete</button>
    `;
    grid.appendChild(item);
  });

  grid.querySelectorAll("[data-delete-image]").forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteImage(btn.dataset.deleteImage));
  });
}

async function handleDeleteImage(imageId) {
  if (!confirm("Delete this image from the library?")) return;
  try {
    await Api.deleteImage(state.password, imageId);
    state.library.images = state.library.images.filter((x) => x.id !== imageId);
    renderPickers();
    renderLibraryManage();
    setStatus("case-status", "Image deleted.", "ok");
  } catch (err) {
    if (err.status === 409 && err.data?.usedBy) {
      const names = err.data.usedBy.map((u) => u.title || u.id).join(", ");
      setStatus("case-status", `Can't delete — still used by: ${names}`, "err");
    } else {
      setStatus("case-status", `Couldn't delete image: ${err.message}`, "err");
    }
  }
}

// ---------- image picker (per ear) ----------

function renderPickers() {
  ["left", "right"].forEach(renderPicker);
}

function renderPicker(ear) {
  const container = document.getElementById(`picker-${ear}`);
  const allTags = new Set();
  state.library.images
    .filter((img) => img.ear === ear)
    .forEach((img) => img.tags.forEach((t) => allTags.add(t)));

  const tagBar = container.querySelector(".tag-bar");
  tagBar.innerHTML = "";
  Array.from(allTags).sort().forEach((tag) => {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.textContent = tag;
    if (state.tagFilter[ear].has(tag)) chip.classList.add("active");
    chip.addEventListener("click", () => {
      if (state.tagFilter[ear].has(tag)) state.tagFilter[ear].delete(tag);
      else state.tagFilter[ear].add(tag);
      renderPicker(ear);
    });
    tagBar.appendChild(chip);
  });

  renderLibraryGrid(ear);
}

function renderLibraryGrid(ear) {
  const grid = document.getElementById(`library-grid-${ear}`);
  const search = state.searchText[ear].toLowerCase().replace(/^#/, "");
  const filtered = state.library.images.filter((img) => {
    if (img.ear !== ear) return false;
    if (state.tagFilter[ear].size > 0) {
      const hasAll = [...state.tagFilter[ear]].every((t) => img.tags.includes(t));
      if (!hasAll) return false;
    }
    if (search && !img.tags.some((t) => t.includes(search))) return false;
    return true;
  });

  grid.innerHTML = "";
  if (filtered.length === 0) {
    grid.innerHTML = `<div class="library-picker-empty">No images match. Try clearing filters, or upload a new image.</div>`;
    return;
  }

  filtered.forEach((img) => {
    const frame = document.createElement("div");
    frame.className = "scope-frame thumb";
    frame.title = img.tags.map((t) => "#" + t).join(" ");
    if (state.selection[ear]?.mode === "library" && state.selection[ear]?.imageId === img.id) {
      frame.classList.add("selected");
    }
    frame.innerHTML = `<img src="${img.path}" alt="${escapeHtml(img.tags.join(', '))}" />`;
    frame.addEventListener("click", () => {
      state.selection[ear] = { mode: "library", imageId: img.id };
      renderLibraryGrid(ear);
    });
    grid.appendChild(frame);
  });
}

function setupSearchAndToggle(ear) {
  const searchInput = document.getElementById(`search-${ear}`);
  searchInput.addEventListener("input", () => {
    state.searchText[ear] = searchInput.value;
    renderLibraryGrid(ear);
  });

  const libraryBtn = document.getElementById(`mode-library-${ear}`);
  const uploadBtn = document.getElementById(`mode-upload-${ear}`);
  const libraryPanel = document.getElementById(`panel-library-${ear}`);
  const uploadPanel = document.getElementById(`panel-upload-${ear}`);

  libraryBtn.addEventListener("click", () => {
    libraryBtn.classList.add("active");
    uploadBtn.classList.remove("active");
    libraryPanel.classList.remove("hidden");
    uploadPanel.classList.add("hidden");
  });
  uploadBtn.addEventListener("click", () => {
    uploadBtn.classList.add("active");
    libraryBtn.classList.remove("active");
    uploadPanel.classList.remove("hidden");
    libraryPanel.classList.add("hidden");
  });

  const fileInput = document.getElementById(`file-${ear}`);
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (file) {
      state.selection[ear] = { mode: "upload", file };
    }
  });
}

// ---------- upload a new image to the library ----------

async function handleUploadImage(ear) {
  const sel = state.selection[ear];
  if (!sel || sel.mode !== "upload" || !sel.file) {
    setStatus("case-status", `Choose a file for the ${ear} ear first.`, "err");
    return;
  }
  const tagsInput = document.getElementById(`upload-tags-${ear}`).value;
  const tags = tagsInput
    .split(",")
    .map((t) => t.trim().toLowerCase().replace(/^#/, ""))
    .filter(Boolean);

  const dataUrl = await fileToDataUrl(sel.file);
  setStatus("case-status", `Uploading ${ear} image…`, "");

  try {
    const result = await Api.uploadImage(state.password, {
      ear,
      tags,
      filename: sel.file.name,
      dataUrl,
    });
    // Merge into local library state so it's immediately pickable
    state.library.images.push(result.image);
    state.selection[ear] = { mode: "library", imageId: result.image.id };
    renderPicker(ear);
    setStatus("case-status", `${capitalize(ear)} image uploaded and added to the library.`, "ok");
  } catch (err) {
    setStatus("case-status", `Upload failed: ${err.message}`, "err");
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- case submission ----------

async function handleCreateCase(e) {
  e.preventDefault();

  const title = document.getElementById("case-title-input").value.trim();
  const difficulty = document.getElementById("case-difficulty-input").value;
  const description = document.getElementById("case-desc-input").value.trim();
  const findings = document.getElementById("case-findings-input").value.trim();

  if (!title) {
    setStatus("case-status", "Title is required.", "err");
    return;
  }

  // If either side is a pending upload, push it to the library first.
  for (const ear of ["left", "right"]) {
    if (state.selection[ear]?.mode === "upload") {
      await handleUploadImage(ear);
    }
  }

  const leftSel = state.selection.left;
  const rightSel = state.selection.right;
  if (!leftSel || leftSel.mode !== "library" || !rightSel || rightSel.mode !== "library") {
    setStatus("case-status", "Select or upload an image for both ears.", "err");
    return;
  }

  const caseData = {
    title,
    difficulty,
    description,
    findings,
    leftImageId: leftSel.imageId,
    rightImageId: rightSel.imageId,
  };

  const isEdit = !!state.editingCaseId;
  setStatus("case-status", isEdit ? "Saving changes…" : "Creating case…", "");
  try {
    const result = isEdit
      ? await Api.updateCase(state.password, state.editingCaseId, caseData)
      : await Api.createCase(state.password, caseData);

    if (isEdit) {
      const entry = state.caseIndex.cases.find((c) => c.id === state.editingCaseId);
      if (entry) { entry.title = title; entry.difficulty = difficulty; }
    } else {
      state.caseIndex.cases.push({ id: result.case.id, title, difficulty });
    }
    renderCaseList();

    const shareUrl = new URL("index.html", window.location.href);
    shareUrl.searchParams.set("case", isEdit ? state.editingCaseId : result.case.id);
    document.getElementById("new-case-share-url").value = shareUrl.toString();
    document.getElementById("new-case-share").classList.remove("hidden");

    setStatus("case-status", isEdit ? "Case updated." : "Case created.", "ok");
    cancelEditCase();
  } catch (err) {
    setStatus("case-status", `Couldn't save case: ${err.message}`, "err");
  }
}

// ---------- helpers ----------

function setStatus(elId, msg, cls) {
  const el = document.getElementById(elId);
  el.textContent = msg;
  el.className = "status-line" + (cls ? " " + cls : "");
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", () => {
  boot();
  setupSearchAndToggle("left");
  setupSearchAndToggle("right");
  document.getElementById("case-form").addEventListener("submit", handleCreateCase);
  document.getElementById("case-cancel-edit-btn").addEventListener("click", () => {
    cancelEditCase();
    setStatus("case-status", "", "");
  });

  document.getElementById("copy-new-case-btn")?.addEventListener("click", async () => {
    const input = document.getElementById("new-case-share-url");
    input.select();
    try { await navigator.clipboard.writeText(input.value); } catch {}
  });
});
