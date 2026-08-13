// api.js — shared data access for viewer.js and admin.js
//
// Reads (cases, library index, images) come straight from this repo's
// /data folder — that's what makes the viewer work on plain GitHub Pages
// with no backend.
//
// Writes (new cases, new library images) go through a small Cloudflare
// Worker, because GitHub Pages itself can't accept uploads. The Worker
// holds the real GitHub token; the browser only ever holds the shared
// admin password. See /worker/worker.js and the README for setup.

const WORKER_URL = "https://otoscopy-admin.YOUR-SUBDOMAIN.workers.dev";

const Api = {
  async getCaseIndex() {
    const res = await fetch("data/cases/index.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load case index");
    return res.json();
  },

  async getCase(caseId) {
    const res = await fetch(`data/cases/${caseId}.json`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Case not found: ${caseId}`);
    return res.json();
  },

  async getLibraryIndex() {
    const res = await fetch("data/library/index.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load image library");
    return res.json();
  },

  // ---- admin writes, via the Worker ----

  async createCase(password, caseData) {
    return Api._post(password, "/api/case", caseData);
  },

  async uploadImage(password, { ear, tags, filename, dataUrl }) {
    return Api._post(password, "/api/image", { ear, tags, filename, dataUrl });
  },

  async _post(password, path, body) {
    const res = await fetch(WORKER_URL + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Password": password,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  },
};
