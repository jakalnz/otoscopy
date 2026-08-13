# Otoscopy Simulator

A case-based otoscopy training tool. Students pick a case and review left
and right otoscopy images before revealing the documented findings.
Supervisors can add cases and build a tagged, searchable image library
through an admin page, and share any case via a direct URL.

## How it's put together

- **Viewer** (`index.html`, `js/viewer.js`) — pure static, runs entirely on
  GitHub Pages. Reads case and image data from JSON files in `/data`.
- **Admin** (`admin.html`, `js/admin.js`) — also static, but *writes* go
  through a small Cloudflare Worker (see below), since GitHub Pages can't
  accept uploads on its own.
- **Worker** (`worker/worker.js`) — the only non-static piece. It checks a
  shared admin password and, if correct, uses the GitHub Contents API to
  commit new case JSON and library images straight into this repo. The
  GitHub token lives only as a Worker secret — the browser never sees it.
- **Data** (`/data/cases/*.json`, `/data/library/index.json`,
  `/data/library/{left,right}/*`) — the source of truth. Every new case or
  image becomes a real commit to the repo, so the library is durable and
  versioned like the rest of your simulators.

Sharing a case is just a URL: `index.html?case=case_perf_001`. The admin
page generates this automatically after a case is created.

## One-time setup

### 1. Deploy the Worker

You'll need a [Cloudflare account](https://dash.cloudflare.com) (free tier
is enough) and [wrangler](https://developers.cloudflare.com/workers/wrangler/):

```bash
cd worker
npm install -g wrangler   # if you don't have it
wrangler login
wrangler deploy
```

Set the two secrets it needs:

```bash
wrangler secret put ADMIN_PASSWORD
# paste the password supervisors will use on admin.html

wrangler secret put GITHUB_TOKEN
# a fine-grained GitHub PAT scoped to Contents: Read and write
# on just this repo — create one at
# github.com/settings/personal-access-tokens/new
```

`wrangler.toml` already has `GITHUB_OWNER` / `GITHUB_REPO` / `GITHUB_BRANCH`
set for this repo — update them if you fork or rename it.

### 2. Point the admin page at your Worker

In `js/api.js`, set:

```js
const WORKER_URL = "https://otoscopy-admin.YOUR-SUBDOMAIN.workers.dev";
```

`wrangler deploy` prints this URL after deploying.

### 3. Enable GitHub Pages

Repo Settings → Pages → deploy from the branch you set as `GITHUB_BRANCH`
(root folder). That's it — `index.html` and `admin.html` are both served
directly.

## Using it

- **Students**: open the site, pick a case, review both ears, reveal
  findings when ready.
- **Supervisors**: go to `/admin.html`, enter the shared password, and
  build a case — pick images from the tagged library (search by
  `#tag`) or upload new ones on the fly. New uploads are tagged at
  upload time and immediately reusable in future cases. After creating a
  case, copy the share link straight from the confirmation box.

## Extending

- **Tag taxonomy**: tags are currently freeform strings. If you want a
  controlled vocabulary (e.g. matching a checklist), constrain the tag
  input in `admin.html`/`admin.js` to a fixed list instead of free text.
- **Access control**: the shared password is enough to stop casual access
  but isn't real authentication — anyone with the password can commit to
  the repo via the Worker. If you need per-supervisor accountability,
  swap the password check for GitHub OAuth device flow and use each
  supervisor's own token.
- **Image size**: uploads go through the Worker as base64 JSON, which is
  fine for typical otoscopy photos (a few hundred KB) but not built for
  very large files — GitHub's Contents API caps individual file commits
  around 1 MB base64-encoded via this endpoint.
