/**
 * Convert SVG emoji to 128×128 PNG using pure Node.js (no native deps).
 * Uses the built-in canvas from Node 26+ or falls back to manual conversion.
 *
 * Usage: node local/svg-to-png.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SVG_DIR = path.join(__dirname, '..', 'assets', 'emoji', 'svg');
const PNG_DIR = path.join(__dirname, '..', 'assets', 'emoji', 'png');

// Use resvg-js (pure Rust WASM, no Python/node-gyp needed)
async function main() {
  console.log('SVG → PNG Emoji Converter');
  console.log('========================\n');

  // Install resvg-js if not present (pure WASM, no native deps)
  try {
    require.resolve('@resvg/resvg-js');
  } catch {
    console.log('Installing @resvg/resvg-js (pure WASM, no Python needed)...\n');
    execSync('npm install @resvg/resvg-js --no-save', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
      env: { ...process.env, YOUTUBE_DL_SKIP_PYTHON_CHECK: '1' }
    });
    console.log('');
  }

  const { Resvg } = require('@resvg/resvg-js');

  const files = fs.readdirSync(SVG_DIR).filter(f => f.endsWith('.svg'));
  fs.mkdirSync(PNG_DIR, { recursive: true });

  console.log(`Source: ${SVG_DIR}`);
  console.log(`Output: ${PNG_DIR}`);
  console.log(`Found: ${files.length} SVG files\n`);

  let converted = 0;
  for (const file of files) {
    const svgPath = path.join(SVG_DIR, file);
    const pngName = file.replace('.svg', '.png');
    const pngPath = path.join(PNG_DIR, pngName);

    const svgData = fs.readFileSync(svgPath, 'utf8');

    const resvg = new Resvg(svgData, {
      fitTo: { mode: 'width', value: 128 },
      background: 'rgba(0,0,0,0)'
    });

    const rendered = resvg.render();
    const pngBuffer = rendered.asPng();

    fs.writeFileSync(pngPath, pngBuffer);
    converted++;

    const sizeKb = (pngBuffer.length / 1024).toFixed(1);
    console.log(`  ✓ ${pngName} (${sizeKb} KB)`);
  }

  console.log(`\n✅ Done! Converted ${converted} emoji to PNG.`);
  console.log(`\nOutput folder: ${PNG_DIR}`);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
