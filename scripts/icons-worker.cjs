const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ailo-icons-')));
app.whenReady().then(() => {
  const source = nativeImage.createFromPath(path.join(root, 'build/icon-source.png'));
  if (source.isEmpty()) throw Error('Icon source could not be loaded.');
  const png = source.resize({ width: 512, height: 512, quality: 'best' }).toPNG();
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = sizes.map(size => source.resize({ width: size, height: size, quality: 'best' }).toPNG());
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  images.forEach((image, i) => {
    const at = 6 + 16 * i;
    header[at] = header[at + 1] = sizes[i] === 256 ? 0 : sizes[i];
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(image.length, at + 8); header.writeUInt32LE(offset, at + 12);
    offset += image.length;
  });
  const ico = Buffer.concat([header, ...images]);
  const publicDir = path.join(root, 'src/renderer/public');
  fs.mkdirSync(publicDir, { recursive: true });
  for (const dir of [path.join(root, 'build'), publicDir]) {
    fs.writeFileSync(path.join(dir, 'icon.png'), png);
    fs.writeFileSync(path.join(dir, 'icon.ico'), ico);
  }
  console.log('Generated 512px PNG and multi-size ICO assets.');
  app.quit();
}).catch(error => { console.error(error.message); app.exit(1); });
