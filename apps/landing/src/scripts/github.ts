// Hydrates download links, release details and repository activity from the
// public GitHub API. Every element has a sensible static fallback, so a
// failed or rate-limited request leaves a working page.

const API = "https://api.github.com/repos/waterrmalann/pg-compass";
const REPO = "https://github.com/waterrmalann/pg-compass";
const LATEST_RELEASE = `${REPO}/releases/latest`;

interface ReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

interface Release {
  name: string | null;
  tag_name: string;
  html_url: string;
  published_at: string | null;
  assets: ReleaseAsset[];
}

interface Repository {
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
}

interface Contributor {
  login: string;
  avatar_url: string;
  html_url: string;
}

interface Commit {
  sha: string;
  html_url: string;
  commit: { message: string; author: { name: string; date: string } | null };
  author: { login: string } | null;
}

type Platform = "windows" | "linux" | "other";

// Asset patterns in priority order, per download row.
const assetPatterns: Record<string, RegExp[]> = {
  windows: [/setup.*\.exe$/i, /\.exe$/i, /\.msi$/i],
  "linux-appimage": [/\.appimage$/i],
  "linux-deb": [/\.deb$/i],
};

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub request failed: ${response.status}`);
  return (await response.json()) as T;
}

function detectPlatform(): Platform {
  const agent = navigator.userAgent.toLowerCase();
  if (agent.includes("windows")) return "windows";
  if (agent.includes("android")) return "other";
  if (agent.includes("linux") || agent.includes("x11")) return "linux";
  return "other";
}

function findAsset(assets: ReleaseAsset[], key: string): ReleaseAsset | undefined {
  for (const pattern of assetPatterns[key] ?? []) {
    const match = assets.find((asset) => pattern.test(asset.name));
    if (match) return match;
  }
  return undefined;
}

function formatSize(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact" }).format(value);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function setText(selector: string, text: string) {
  document.querySelectorAll<HTMLElement>(selector).forEach((node) => {
    node.textContent = text;
  });
}

function updatePrimaryDownload(release: Release | null) {
  const platform = detectPlatform();
  const assetKey = platform === "windows" ? "windows" : platform === "linux" ? "linux-appimage" : null;
  const asset = release && assetKey ? findAsset(release.assets, assetKey) : undefined;

  const labels: Record<Platform, string> = {
    windows: "Download for Windows",
    linux: "Download for Linux",
    other: "Download the latest release",
  };
  const label = asset ? labels[platform] : labels.other;

  document.querySelectorAll<HTMLAnchorElement>("[data-download-primary]").forEach((link) => {
    link.href = asset?.browser_download_url ?? LATEST_RELEASE;
  });
  setText("[data-download-label]", label);
}

function updateRelease(release: Release) {
  setText("[data-release-name]", release.name || release.tag_name);
  setText("[data-release-date]", release.published_at ? formatDate(release.published_at) : "—");
  setText("[data-release-assets]", String(release.assets.length));
  document.querySelectorAll<HTMLAnchorElement>("[data-release-link]").forEach((link) => {
    link.href = release.html_url;
  });

  document.querySelectorAll<HTMLAnchorElement>("[data-platform-asset]").forEach((link) => {
    const asset = findAsset(release.assets, link.dataset.platformAsset ?? "");
    if (!asset) return;
    link.href = asset.browser_download_url;
    const size = link.querySelector("[data-asset-size]");
    if (size) size.textContent = formatSize(asset.size);
  });
}

async function hydrateRelease() {
  try {
    const release = await fetchJson<Release>("/releases/latest");
    updateRelease(release);
    updatePrimaryDownload(release);
  } catch {
    setText("[data-release-name]", "See GitHub");
    updatePrimaryDownload(null);
  }
}

function renderContributors(contributors: Contributor[]) {
  const container = document.querySelector<HTMLElement>("[data-contributors]");
  if (!container || contributors.length === 0) return;

  const avatars = contributors.slice(0, 12).map((contributor) => {
    const link = document.createElement("a");
    link.href = contributor.html_url;
    link.target = "_blank";
    link.rel = "noopener";
    link.title = `@${contributor.login}`;
    link.className =
      "block size-10 overflow-hidden rounded-full border border-border/70 bg-muted opacity-80 transition-opacity hover:opacity-100";
    const image = document.createElement("img");
    image.src = `${contributor.avatar_url}&s=80`;
    image.alt = `@${contributor.login}`;
    image.width = 40;
    image.height = 40;
    image.loading = "lazy";
    image.className = "size-full object-cover";
    link.append(image);
    return link;
  });
  container.replaceChildren(...avatars);
}

// Replaces the "Loading recent commits…" row when the request fails or
// returns nothing, so a settled failure never reads as still loading.
function renderCommitsUnavailable() {
  const list = document.querySelector<HTMLElement>("[data-commits]");
  if (!list) return;

  const item = document.createElement("li");
  item.className = "flex h-10 items-center px-4 text-[13px] text-muted-foreground";
  item.textContent = "Recent commits are unavailable right now.";
  list.replaceChildren(item);
}

function renderCommits(commits: Commit[]) {
  const list = document.querySelector<HTMLElement>("[data-commits]");
  if (!list) return;
  if (commits.length === 0) {
    renderCommitsUnavailable();
    return;
  }

  const rows = commits.slice(0, 6).map((commit) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = commit.html_url;
    link.target = "_blank";
    link.rel = "noopener";
    link.className =
      "flex h-10 items-center gap-3 border-b border-border/70 px-4 text-[13px] transition-colors hover:bg-muted/40";

    const sha = document.createElement("span");
    sha.className = "shrink-0 font-mono text-xs text-subtle-foreground";
    sha.textContent = commit.sha.slice(0, 7);

    const message = document.createElement("span");
    message.className = "min-w-0 flex-1 truncate";
    message.textContent = commit.commit.message.split("\n")[0] ?? "";

    const author = document.createElement("span");
    author.className = "hidden shrink-0 text-xs text-muted-foreground sm:inline";
    author.textContent = commit.author ? `@${commit.author.login}` : (commit.commit.author?.name ?? "");

    link.append(sha, message, author);
    item.append(link);
    return item;
  });
  list.replaceChildren(...rows);
}

async function hydrateRepository() {
  const [repo, contributors, commits] = await Promise.allSettled([
    fetchJson<Repository>(""),
    fetchJson<Contributor[]>("/contributors?per_page=12"),
    fetchJson<Commit[]>("/commits?per_page=6"),
  ]);

  if (repo.status === "fulfilled") {
    setText('[data-repo-stat="stars"]', formatCount(repo.value.stargazers_count));
    setText('[data-repo-stat="forks"]', formatCount(repo.value.forks_count));
    setText('[data-repo-stat="issues"]', formatCount(repo.value.open_issues_count));
    setText("[data-github-stars]", `${formatCount(repo.value.stargazers_count)} stars`);
  }
  if (contributors.status === "fulfilled") renderContributors(contributors.value);
  if (commits.status === "fulfilled") renderCommits(commits.value);
  else renderCommitsUnavailable();
}

export function hydrateGitHub() {
  void hydrateRelease();
  void hydrateRepository();
}
