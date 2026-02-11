const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function shortSha(sha) {
  const s = String(sha || "").trim();
  return s ? s.slice(0, 7) : "";
}

async function safeExecGit(args, { cwd }) {
  try {
    const res = await execFileAsync("git", args, {
      cwd,
      timeout: 1500,
      windowsHide: true
    });
    return { ok: true, stdout: String(res.stdout || "").trim() };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

async function getLocalGitInfo({ cwd }) {
  const inside = await safeExecGit(["rev-parse", "--is-inside-work-tree"], { cwd });
  if (!inside.ok || inside.stdout !== "true") {
    return { available: false };
  }

  const head = await safeExecGit(["rev-parse", "HEAD"], { cwd });
  const branch = await safeExecGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  const log = await safeExecGit(
    ["log", "-1", "--pretty=%H%n%an%n%ad%n%s", "--date=iso-strict"],
    { cwd }
  );

  let author = "";
  let date = "";
  let subject = "";
  if (log.ok) {
    const lines = log.stdout.split("\n");
    // %H is redundant with head, but keep parsing simple.
    author = lines[1] || "";
    date = lines[2] || "";
    subject = lines.slice(3).join("\n").trim();
  }

  return {
    available: true,
    commit: head.ok ? head.stdout : "",
    commitShort: head.ok ? shortSha(head.stdout) : "",
    branch: branch.ok ? branch.stdout : "",
    author,
    date,
    subject
  };
}

async function fetchGithubLatestCommit({ owner, repo, branch }) {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(branch)}`;

  const resp = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "TopMusicaLivePix"
    }
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`GitHub API failed: HTTP ${resp.status} ${txt}`.trim());
  }

  const json = await resp.json();
  const sha = json?.sha || "";
  const subject = json?.commit?.message || "";
  const author = json?.commit?.author?.name || "";
  const date = json?.commit?.author?.date || "";
  const htmlUrl = json?.html_url || "";

  return {
    commit: sha,
    commitShort: shortSha(sha),
    subject: String(subject).split("\n")[0] || "",
    author,
    date,
    url: htmlUrl
  };
}

function createVersionService({
  owner,
  repo,
  branch = "main",
  cacheTtlMs = 60_000,
  rootDir = process.cwd()
} = {}) {
  const state = {
    remote: null,
    remoteCheckedAt: 0,
    remoteError: null
  };

  async function getRemote() {
    const now = Date.now();
    if (state.remote && now - state.remoteCheckedAt < cacheTtlMs) {
      return { ok: true, data: state.remote, checkedAt: state.remoteCheckedAt };
    }

    try {
      const data = await fetchGithubLatestCommit({ owner, repo, branch });
      state.remote = data;
      state.remoteCheckedAt = now;
      state.remoteError = null;
      return { ok: true, data, checkedAt: now };
    } catch (e) {
      state.remoteError = String(e?.message || e);
      return { ok: false, error: state.remoteError, checkedAt: now };
    }
  }

  async function getVersionInfo() {
    const cwd = rootDir;
    const pkgPath = path.join(cwd, "package.json");
    let pkgVersion = "";
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      pkgVersion = require(pkgPath).version || "";
    } catch {
      pkgVersion = "";
    }

    const local = await getLocalGitInfo({ cwd });
    const remoteRes = await getRemote();

    let upToDate = null;
    if (local.available && remoteRes.ok && local.commit && remoteRes.data.commit) {
      upToDate = local.commit === remoteRes.data.commit;
    }

    return {
      ok: true,
      repo: { owner, name: repo, branch },
      local: { packageVersion: pkgVersion, git: local },
      remote: remoteRes.ok
        ? { ok: true, checkedAt: remoteRes.checkedAt, ...remoteRes.data }
        : { ok: false, checkedAt: remoteRes.checkedAt, error: remoteRes.error || "unknown" },
      upToDate
    };
  }

  return { getVersionInfo };
}

module.exports = { createVersionService };
