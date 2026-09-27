import landingPackage from "../../package.json";

export const appVersion = landingPackage.version;

export const repoUrl = "https://github.com/waterrmalann/pg-compass";

export const links = {
  repo: repoUrl,
  readme: `${repoUrl}#readme`,
  releases: `${repoUrl}/releases`,
  latestRelease: `${repoUrl}/releases/latest`,
  issues: `${repoUrl}/issues`,
  newIssue: `${repoUrl}/issues/new`,
  pulls: `${repoUrl}/pulls`,
  discussions: `${repoUrl}/discussions`,
  license: `${repoUrl}/blob/main/LICENSE`,
  contributing: `${repoUrl}#contributing`,
  commits: `${repoUrl}/commits/main`,
  contributors: `${repoUrl}/graphs/contributors`,
};

/** Joins a path onto Astro's base URL (the site is served from /pg-compass). */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}${path.replace(/^\//, "")}`;
}
