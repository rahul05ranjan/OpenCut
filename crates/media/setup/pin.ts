// Points crates/media/setup/ffmpeg.json at the FFmpeg prebuilts that the
// "Media dependencies" workflow (.github/workflows/media-deps.yml) publishes
// under a release tag, completing the flow its release notes describe:
//
//   bun run crates/media/setup/pin.ts ffmpeg-8.1.3-1
//
// The release carries one ffmpeg-<version>-<platform>.tar.gz per platform
// plus the checksums.sha256 the workflow generated, and the release notes
// tell the operator to run this script with the tag. Every platform asset
// the release carries is pinned in the manifest; a platform already pinned
// is re-pointed, one the manifest does not carry yet is added, so the
// prebuilt the workflow built for it is actually used. Platforms pinned in
// the manifest that the release does not carry keep their current pin and
// are listed as a warning. The source pin is left alone: the release
// repackages the same pinned source build.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type Download = { url: string; sha256: string };

const manifestPath = join(dirname(fileURLToPath(import.meta.url)), "ffmpeg.json");

function parseChecksums(text: string): Map<string, string> {
  const checksums = new Map<string, string>();
  for (const line of text.split("\n")) {
    const [hash, name] = line.trim().split(/\s+/, 2);
    if (hash && name) {
      checksums.set(name, hash);
    }
  }
  return checksums;
}

function assetUrl(tag: string, name: string): string {
  const repo = process.env.GITHUB_REPOSITORY || "OpenCut-app/OpenCut";
  return `https://github.com/${repo}/releases/download/${tag}/${name}`;
}

function isEntryModule(): boolean {
  const script = process.argv[1];
  if (!script) return false;
  const resolved = isAbsolute(script) ? script : join(process.cwd(), script);
  return import.meta.url === pathToFileURL(resolved).href;
}

async function pin(tag: string): Promise<void> {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (typeof manifest.version !== "string") {
    throw new Error("ffmpeg.json: missing version");
  }

  const assetPrefix = `ffmpeg-${manifest.version}-`;
  if (!tag.startsWith(assetPrefix)) {
    throw new Error(
      `release tag "${tag}" does not carry ffmpeg ${manifest.version}: ` +
        `expected a "${assetPrefix}<build>" tag from the Media dependencies workflow`,
    );
  }

  console.log(`fetching checksums.sha256 for ${tag}`);
  const response = await fetch(assetUrl(tag, "checksums.sha256"));
  if (!response.ok) {
    throw new Error(`download failed: ${response.status} ${response.url}`);
  }
  const checksums = parseChecksums(await response.text());

  const platforms: Record<string, Download> = manifest.platforms ?? {};
  const before = new Set(Object.keys(platforms));

  for (const [name, sha256] of checksums) {
    if (!name.startsWith(assetPrefix) || !name.endsWith(".tar.gz")) {
      continue;
    }
    const key = name.slice(assetPrefix.length, -".tar.gz".length);
    platforms[key] = { url: assetUrl(tag, name), sha256 };
  }

  const pinned = Object.keys(platforms).sort();
  const added = pinned.filter((key) => !before.has(key));
  const missing = pinned.filter(
    (key) => before.has(key) && !checksums.has(`${assetPrefix}${key}.tar.gz`),
  );
  if (pinned.length === 0) {
    throw new Error(
      `release ${tag} carries no ${assetPrefix}<platform>.tar.gz assets`,
    );
  }

  manifest.platforms = Object.fromEntries(
    pinned.map((key) => [key, platforms[key]]),
  );

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`pinned ffmpeg ${manifest.version} to ${tag}:`);
  for (const key of pinned) {
    console.log(`  ${key}${added.includes(key) ? " (newly pinned)" : ""}`);
  }
  for (const key of missing) {
    console.warn(
      `  warning: ${key} is not in release ${tag}; its previous pin is kept`,
    );
  }
}

async function main(): Promise<void> {
  const tag = process.argv[2];
  if (!tag || tag.startsWith("-")) {
    throw new Error(
      "usage: bun run crates/media/setup/pin.ts <release-tag>  " +
        "(the ffmpeg-<version>-<build> tag of a Media dependencies release)",
    );
  }
  await pin(tag);
}

if (isEntryModule()) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

export { assetUrl, parseChecksums, pin };
