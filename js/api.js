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

const WORKER_URL = "https://otoscopy-admin.mpsanders.workers.dev";

const Api = {
  async getCaseIndex() {
    const res = await fetch(`data/cases/index.json?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load case index");
    return res.json();
  },

  async getCase(caseId) {
    const res = await fetch(`data/cases/${caseId}.json?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Case not found: ${caseId}`);
    return res.json();
  },

  async getLibraryIndex() {
    const res = await fetch(`data/library/index.json?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load image library");
    return res.json();
  },

  // ---- admin writes, via the Worker ----

  async createCase(password, caseData) {
    return Api._request("POST", password, "/api/case", caseData);
  },

  async updateCase(password, caseId, caseData) {
    return Api._request("PUT", password, `/api/case/${caseId}`, caseData);
  },

  async deleteCase(password, caseId) {
    return Api._request("DELETE", password, `/api/case/${caseId}`);
  },

  async uploadImage(password, { ear, tags, filename, dataUrl }) {
    return Api._request("POST", password, "/api/image", { ear, tags, filename, dataUrl });
  },

  async deleteImage(password, imageId) {
    return Api._request("DELETE", password, `/api/image/${imageId}`);
  },

  async _request(method, password, path, body) {
    const res = await fetch(WORKER_URL + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Password": password,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  },
};
