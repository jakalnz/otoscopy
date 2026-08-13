/**
 * Cloudflare Worker — admin write proxy for the Otoscopy Simulator.
 *
 * Why this exists: GitHub Pages only serves static files, it can't accept
 * writes. This Worker is the one piece of "backend" — it holds the real
 * GitHub token (as a secret, never sent to the browser) and checks a
 * shared password before committing anything. The admin page only ever
 * knows the password, not the token.
 *
 * Required secrets/vars (set with `wrangler secret put ...`):
 *   ADMIN_PASSWORD   - the shared password supervisors enter on admin.html
 *   GITHUB_TOKEN     - a fine-grained PAT with Contents: read/write on the repo
 *   GITHUB_OWNER     - e.g. "jakalnz"
 *   GITHUB_REPO      - e.g. "otoscopy-simulator"
 *   GITHUB_BRANCH    - e.g. "main"
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // tighten to your Pages origin in production
  "Access-Control-Allow-Methods": "POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const method = request.method;

    if (!["POST", "PUT", "DELETE"].includes(method)) {
      return json({ error: "Not found" }, 404);
    }

    const password = request.headers.get("X-Admin-Password") || "";
    if (password !== env.ADMIN_PASSWORD) {
      return json({ error: "Incorrect password" }, 401);
    }

    const caseMatch = url.pathname.match(/^\/api\/case\/([^/]+)$/);
    const imageMatch = url.pathname.match(/^\/api\/image\/([^/]+)$/);

    try {
      if (method === "POST" && url.pathname === "/api/case") {
        return await handleCreateCase(request, env);
      }
      if (method === "POST" && url.pathname === "/api/image") {
        return await handleUploadImage(request, env);
      }
      if (method === "PUT" && caseMatch) {
        return await handleUpdateCase(request, env, caseMatch[1]);
      }
      if (method === "DELETE" && caseMatch) {
        return await handleDeleteCase(env, caseMatch[1]);
      }
      if (method === "DELETE" && imageMatch) {
        return await handleDeleteImage(env, imageMatch[1]);
      }
      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: err.message || "Server error" }, 500);
    }
  },
};

// ---------- handlers ----------

async function handleCreateCase(request, env) {
  const body = await request.json();
  const { title, difficulty, description, findings, leftImageId, rightImageId } = body;

  if (!title || !leftImageId || !rightImageId) {
    return json({ error: "Missing required case fields" }, 400);
  }

  const id = "case_" + slugify(title) + "_" + shortId();
  const caseData = {
    id,
    title,
    difficulty: difficulty || "beginner",
    description: description || "",
    findings,
    leftImageId,
    rightImageId,
    createdAt: new Date().toISOString(),
    createdBy: "admin",
  };

  await putFile(
    env,
    `data/cases/${id}.json`,
    JSON.stringify(caseData, null, 2),
    `Add case: ${title}`
  );

  await updateJsonFile(env, "data/cases/index.json", `Add ${id} to case index`, (indexData) => {
    indexData.cases.push({ id, title, difficulty: caseData.difficulty });
    return indexData;
  });

  return json({ case: caseData });
}

async function handleUpdateCase(request, env, id) {
  const body = await request.json();
  const { title, difficulty, description, findings, leftImageId, rightImageId } = body;

  if (!title || !leftImageId || !rightImageId) {
    return json({ error: "Missing required case fields" }, 400);
  }

  const existing = await getFile(env, `data/cases/${id}.json`);
  if (!existing) return json({ error: "Case not found" }, 404);
  const previous = decodeFileJson(existing);

  const caseData = {
    ...previous,
    title,
    difficulty: difficulty || "beginner",
    description: description || "",
    findings: findings || "",
    leftImageId,
    rightImageId,
  };

  await putFile(
    env,
    `data/cases/${id}.json`,
    JSON.stringify(caseData, null, 2),
    `Update case: ${title}`
  );

  await updateJsonFile(env, "data/cases/index.json", `Update ${id} in case index`, (indexData) => {
    const entry = indexData.cases.find((c) => c.id === id);
    if (entry) {
      entry.title = title;
      entry.difficulty = caseData.difficulty;
    }
    return indexData;
  });

  return json({ case: caseData });
}

async function handleDeleteCase(env, id) {
  const existing = await getFile(env, `data/cases/${id}.json`);
  if (!existing) return json({ error: "Case not found" }, 404);

  await deleteFile(env, `data/cases/${id}.json`, existing.sha, `Delete case: ${id}`);

  await updateJsonFile(env, "data/cases/index.json", `Remove ${id} from case index`, (indexData) => {
    indexData.cases = indexData.cases.filter((c) => c.id !== id);
    return indexData;
  });

  return json({ deleted: id });
}

async function handleDeleteImage(env, id) {
  const libraryFile = await getFile(env, "data/library/index.json");
  const library = libraryFile ? decodeFileJson(libraryFile) : { images: [] };

  const image = library.images.find((img) => img.id === id);
  if (!image) return json({ error: "Image not found" }, 404);

  const casesFile = await getFile(env, "data/cases/index.json");
  const caseIndex = casesFile ? decodeFileJson(casesFile) : { cases: [] };

  const usedBy = [];
  for (const c of caseIndex.cases) {
    const caseFile = await getFile(env, `data/cases/${c.id}.json`);
    if (!caseFile) continue;
    const caseData = decodeFileJson(caseFile);
    if (caseData.leftImageId === id || caseData.rightImageId === id) {
      usedBy.push({ id: c.id, title: c.title });
    }
  }

  if (usedBy.length > 0) {
    return json({ error: "Image is still used by one or more cases", usedBy }, 409);
  }

  const imageFile = await getFile(env, image.path);
  if (imageFile) {
    await deleteFile(env, image.path, imageFile.sha, `Delete library image: ${id}`);
  }

  await updateJsonFile(env, "data/library/index.json", `Remove ${id} from library index`, (indexData) => {
    indexData.images = indexData.images.filter((img) => img.id !== id);
    return indexData;
  });

  return json({ deleted: id });
}

async function handleUploadImage(request, env) {
  const body = await request.json();
  const { ear, tags, filename, dataUrl } = body;

  if (!ear || !["left", "right"].includes(ear)) {
    return json({ error: "ear must be 'left' or 'right'" }, 400);
  }
  if (!dataUrl || !dataUrl.startsWith("data:")) {
    return json({ error: "Missing image data" }, 400);
  }

  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return json({ error: "Malformed image data" }, 400);
  const [, mime, base64] = match;
  const ext = extForMime(mime, filename);

  const id = "img_" + shortId();
  const path = `data/library/${ear}/${id}.${ext}`;

  await putFileBase64(env, path, base64, `Add ${ear} library image ${id}`);

  const imageRecord = {
    id,
    ear,
    path,
    tags: Array.isArray(tags) ? tags : [],
    uploadedAt: new Date().toISOString(),
    uploadedBy: "admin",
  };

  await updateJsonFile(env, "data/library/index.json", `Add ${id} to library index`, (indexData) => {
    indexData.images.push(imageRecord);
    return indexData;
  });

  return json({ image: imageRecord });
}

// ---------- GitHub Contents API helpers ----------

const GH_API = "https://api.github.com";

function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "otoscopy-simulator-worker",
  };
}

async function getFile(env, path) {
  const res = await fetch(
    `${GH_API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=${env.GITHUB_BRANCH}`,
    { headers: ghHeaders(env) }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub read failed (${res.status})`);
  return res.json(); // includes .sha and base64 .content
}

function decodeFileJson(file) {
  return JSON.parse(decodeURIComponent(escape(atob(file.content.replace(/\n/g, "")))));
}

async function putFile(env, path, textContent, message) {
  const base64 = btoa(unescape(encodeURIComponent(textContent)));
  return putFileBase64(env, path, base64, message);
}

async function putFileBase64(env, path, base64Content, message) {
  const existing = await getFile(env, path);
  const res = await fetch(
    `${GH_API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`,
    {
      method: "PUT",
      headers: ghHeaders(env),
      body: JSON.stringify({
        message,
        content: base64Content,
        branch: env.GITHUB_BRANCH,
        ...(existing ? { sha: existing.sha } : {}),
      }),
    }
  );
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`GitHub write failed (${res.status}): ${errBody}`);
  }
  return res.json();
}

async function deleteFile(env, path, sha, message) {
  const res = await fetch(
    `${GH_API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`,
    {
      method: "DELETE",
      headers: ghHeaders(env),
      body: JSON.stringify({
        message,
        sha,
        branch: env.GITHUB_BRANCH,
      }),
    }
  );
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`GitHub delete failed (${res.status}): ${errBody}`);
  }
  return res.json();
}

async function updateJsonFile(env, path, message, mutateFn) {
  const existing = await getFile(env, path);
  const current = existing ? decodeFileJson(existing) : {};
  const updated = mutateFn(current);
  const base64 = btoa(unescape(encodeURIComponent(JSON.stringify(updated, null, 2))));

  const res = await fetch(
    `${GH_API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`,
    {
      method: "PUT",
      headers: ghHeaders(env),
      body: JSON.stringify({
        message,
        content: base64,
        branch: env.GITHUB_BRANCH,
        ...(existing ? { sha: existing.sha } : {}),
      }),
    }
  );
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`GitHub index update failed (${res.status}): ${errBody}`);
  }
  return updated;
}

// ---------- small utils ----------

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

function shortId() {
  return Math.random().toString(36).slice(2, 8);
}

function extForMime(mime, filename) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/svg+xml") return "svg";
  if (filename && filename.includes(".")) return filename.split(".").pop();
  return "jpg";
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
