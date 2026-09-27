import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const versionFiles = [
  "apps/desktop/package.json",
  "apps/landing/package.json",
];

const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const bumpArg = args.find((arg) => arg !== "--dry-run");

if (!bumpArg || bumpArg === "--help" || bumpArg === "-h") {
  printUsage();
  process.exit(bumpArg ? 0 : 1);
}

const packageFiles = await Promise.all(
  versionFiles.map(async (relativePath) => {
    const absolutePath = path.resolve(relativePath);
    const raw = await readFile(absolutePath, "utf8");
    const data = JSON.parse(raw);

    if (typeof data.version !== "string" || !semverPattern.test(data.version)) {
      throw new Error(
        `${relativePath} has an invalid version: ${data.version}`,
      );
    }

    return { relativePath, absolutePath, data };
  }),
);

const currentVersions = new Set(packageFiles.map((file) => file.data.version));

if (currentVersions.size !== 1) {
  const versions = packageFiles
    .map((file) => `${file.relativePath}: ${file.data.version}`)
    .join("\n");

  throw new Error(`Version files are out of sync:\n${versions}`);
}

const currentVersion = packageFiles[0].data.version;
const nextVersion = resolveNextVersion(currentVersion, bumpArg);

if (dryRun) {
  console.log(`[dry-run] ${currentVersion} -> ${nextVersion}`);
  for (const file of packageFiles) {
    console.log(`[dry-run] ${file.relativePath}`);
  }
  process.exit(0);
}

for (const file of packageFiles) {
  file.data.version = nextVersion;
  await writeFile(
    file.absolutePath,
    `${JSON.stringify(file.data, null, 2)}\n`,
    "utf8",
  );
}

console.log(`Version bumped: ${currentVersion} -> ${nextVersion}`);

function resolveNextVersion(currentVersion, bump) {
  if (semverPattern.test(bump)) {
    return bump;
  }

  const [major, minor, patch] = currentVersion
    .match(semverPattern)
    .slice(1, 4)
    .map(Number);

  if (bump === "major") {
    return `${major + 1}.0.0`;
  }

  if (bump === "minor") {
    return `${major}.${minor + 1}.0`;
  }

  if (bump === "patch") {
    return `${major}.${minor}.${patch + 1}`;
  }

  throw new Error(
    `Unsupported bump "${bump}". Use patch, minor, major, or an explicit version.`,
  );
}

function printUsage() {
  console.log(`Usage: pnpm version:bump <patch|minor|major|x.y.z> [--dry-run]`);
}
