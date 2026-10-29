// Regenerates every raster brand icon from public/icons/logo.svg.
// Run from apps/web after editing the logo: node scripts/generate-brand-icons.mjs
//
// sharp is not a direct dependency; Next ships it for image optimization,
// so it is resolved through next's own install.
import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)
const sharp = createRequire(require.resolve("next/package.json"))("sharp")

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "public")
const icons = join(root, "icons")
const logo = readFileSync(join(icons, "logo.svg"), "utf8")

// Full-bleed variant: square tile (the platform applies its own mask) with
// the glyph scaled into the centre so nothing is clipped. Maskable icons
// must keep content inside the inner 80% safe zone.
function fullBleed(scale) {
  const offset = (32 * (1 - scale)).toFixed(2)
  return logo
    .replace('rx="15" fill="url(#tile)"/>', `fill="url(#tile)"/>\n  <g transform="translate(${offset} ${offset}) scale(${scale})">`)
    .replace("</svg>", "  </g>\n</svg>")
}

const render = (svg, size) =>
  sharp(Buffer.from(svg), { density: Math.ceil((72 * size) / 64) * 2 }).resize(size, size).png().toBuffer()

const outputs = [
  ["favicon-32.png", logo, 32],
  ["icon-192.png", logo, 192],
  ["icon-512.png", logo, 512],
  ["icon-maskable-512.png", fullBleed(0.72), 512],
  ["apple-touch-icon.png", fullBleed(0.86), 180],
]
for (const [name, svg, size] of outputs) {
  writeFileSync(join(icons, name), await render(svg, size))
}

// favicon.ico with PNG-encoded 16/32/48 entries: crawlers (Google's
// search-result favicon wants a multiple of 48px) and older browsers still
// request /favicon.ico directly.
const sizes = [16, 32, 48]
const pngs = await Promise.all(sizes.map((s) => render(logo, s)))
const header = Buffer.alloc(6 + 16 * sizes.length)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(sizes.length, 4)
let offset = header.length
sizes.forEach((size, i) => {
  const entry = 6 + 16 * i
  header.writeUInt8(size, entry)
  header.writeUInt8(size, entry + 1)
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(pngs[i].length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += pngs[i].length
})
writeFileSync(join(root, "favicon.ico"), Buffer.concat([header, ...pngs]))

console.log(`Wrote ${outputs.length} PNG icons and favicon.ico`)
