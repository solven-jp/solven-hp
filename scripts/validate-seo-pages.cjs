const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const htmlFiles = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(filePath);
    } else if (entry.name.endsWith(".html")) {
      htmlFiles.push(filePath);
    }
  }
}

function getMatch(source, pattern) {
  const match = source.match(pattern);
  return match ? match[1].trim() : "";
}

walk(publicDir);

let ok = true;
const seen = {
  title: new Map(),
  description: new Map(),
  canonical: new Map(),
};

for (const file of htmlFiles.sort()) {
  const source = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file);
  const title = getMatch(source, /<title>([\s\S]*?)<\/title>/i);
  const description = getMatch(source, /<meta name="description" content="([^"]+)"/i);
  const canonical = getMatch(source, /<link rel="canonical" href="([^"]+)"/i);
  const h1s = [...source.matchAll(/<h1[\s\S]*?>([\s\S]*?)<\/h1>/gi)].map((match) =>
    match[1].replace(/<[^>]*>/g, "").trim()
  );

  for (const [name, value] of Object.entries({ title, description, canonical })) {
    if (!value) {
      console.error(`${rel}: missing ${name}`);
      ok = false;
      continue;
    }
    const bucket = seen[name];
    if (bucket.has(value)) {
      console.error(`${rel}: duplicate ${name} with ${bucket.get(value)}`);
      ok = false;
    }
    bucket.set(value, rel);
  }

  if (h1s.length !== 1) {
    console.error(`${rel}: h1 count ${h1s.length}`);
    ok = false;
  }

  const ldJsonBlocks = [...source.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  for (const [index, match] of ldJsonBlocks.entries()) {
    try {
      JSON.parse(match[1]);
    } catch (error) {
      console.error(`${rel}: invalid JSON-LD #${index + 1}: ${error.message}`);
      ok = false;
    }
  }

  console.log(`${rel}: title, description, h1, canonical, JSON-LD checked`);
}

const sitemap = fs.readFileSync(path.join(publicDir, "sitemap.xml"), "utf8");
for (const file of htmlFiles) {
  const rel = path.relative(publicDir, file).replace(/(^|\/)index\.html$/, "$1").replace(/\/$/, "");
  const url = `https://solven.jp/${rel}`;
  if (!sitemap.includes(`<loc>${url}</loc>`)) {
    console.error(`sitemap missing ${url}`);
    ok = false;
  }
}

const robots = fs.readFileSync(path.join(publicDir, "robots.txt"), "utf8");
if (!robots.includes("Sitemap: https://solven.jp/sitemap.xml")) {
  console.error("robots sitemap missing");
  ok = false;
}

process.exit(ok ? 0 : 1);
