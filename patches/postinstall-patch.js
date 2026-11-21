/*
Patched Electron Postinstall Handler
Repository: https://github.com/bigjakk/Electron-Websocket-Fix

Automatically downloads and installs the custom patched Electron v44.0.0
build containing:
1. Input priority patch (eliminates aim/shooting WebSocket starvation)
2. Frame pacing patch (avoids runaway frame loops under uncapped FPS)
3. CustomMaxPendingFrames & CustomFrameCap support
*/

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execSync } = require('child_process');

const PATCH_VERSION = 'v44.0.0';
const MARKER_FILE = `ws-patched-${PATCH_VERSION}.marker`;

function getPlatformPath() {
  const platform = process.env.npm_config_platform || os.platform();
  switch (platform) {
    case 'mas':
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron';
    case 'freebsd':
    case 'openbsd':
    case 'linux':
      return 'electron';
    case 'win32':
      return 'electron.exe';
    default:
      throw new Error('Unsupported platform: ' + platform);
  }
}

function getPatchedAssetName(platform, arch) {
  if (platform === 'win32' && arch === 'x64') {
    return `electron-${PATCH_VERSION}-ws-frameThrottle-frameCap2-patched-windows-x64.zip`;
  }
  if (platform === 'linux' && arch === 'x64') {
    return `electron-${PATCH_VERSION}-ws-frameThrottle-frameCap2-patched-linux-x64.zip`;
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return `electron-${PATCH_VERSION}-ws-frameThrottle-frameCap2-patched-mac-arm64.zip`;
  }
  return null;
}

function downloadFile(targetUrl, destPath) {
  return new Promise((resolve, reject) => {
    https.get(targetUrl, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed with HTTP ${res.statusCode} from ${targetUrl}`));
      }

      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      const totalMB = totalBytes ? (totalBytes / 1024 / 1024).toFixed(1) : '?';
      console.log(`Downloading patched Electron (${totalMB} MB)...`);

      const file = fs.createWriteStream(destPath);
      let downloaded = 0;
      let lastPercent = -1;

      res.on('data', chunk => {
        downloaded += chunk.length;
        if (totalBytes > 0) {
          const pct = Math.floor((downloaded / totalBytes) * 100);
          if (pct >= lastPercent + 15 || pct === 100) {
            lastPercent = pct;
            console.log(`Progress: ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} MB)`);
          }
        }
      });

      res.pipe(file);

      file.on('finish', () => {
        file.close(() => resolve());
      });

      file.on('error', err => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }).on('error', reject);
  });
}

function extractZip(zipPath, targetDir) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });

  console.log(`Extracting patched Electron to ${targetDir}...`);
  try {
    // bsdtar is built into modern Windows (tar.exe), macOS, and Linux
    execSync(`tar -xf "${zipPath}" -C "${targetDir}"`, { stdio: 'inherit' });
    return;
  } catch (_) {}

  if (process.platform === 'win32') {
    const psCommand = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${targetDir.replace(/'/g, "''")}' -Force`;
    execSync(`powershell -NoProfile -Command "${psCommand}"`, { stdio: 'inherit' });
  } else {
    try {
      execSync(`unzip -q -o "${zipPath}" -d "${targetDir}"`, { stdio: 'inherit' });
    } catch {
      execSync(`python3 -m zipfile -e "${zipPath}" "${targetDir}"`, { stdio: 'inherit' });
    }
  }
}

async function setup() {
  const electronDir = path.resolve(__dirname, '..', 'node_modules', 'electron');
  const distDir = path.join(electronDir, 'dist');
  const pathTxt = path.join(electronDir, 'path.txt');
  const platformPath = getPlatformPath();
  const exePath = path.join(distDir, platformPath);
  const markerPath = path.join(distDir, MARKER_FILE);

  if (fs.existsSync(exePath) && fs.existsSync(pathTxt) && fs.existsSync(markerPath)) {
    console.log(`Patched Electron (${PATCH_VERSION}) is already installed and verified.`);
    return;
  }

  const platform = process.env.npm_config_platform || os.platform();
  const arch = process.env.npm_config_arch || os.arch();
  const assetName = getPatchedAssetName(platform, arch);

  if (!assetName) {
    console.warn(`[Warning] No prebuilt patched Electron binary found for ${platform}-${arch} in bigjakk/Electron-Websocket-Fix.`);
    console.warn('Falling back to standard @electron/get artifact...');
    const { downloadArtifact } = require('@electron/get');
    const zipPath = await downloadArtifact({
      version: '44.0.0',
      artifactName: 'electron',
      platform,
      arch
    });
    extractZip(zipPath, distDir);
    fs.writeFileSync(pathTxt, platformPath, 'utf8');
    return;
  }

  const downloadUrl = `https://github.com/bigjakk/Electron-Websocket-Fix/releases/download/${PATCH_VERSION}/${assetName}`;
  const tempZipPath = path.join(os.tmpdir(), assetName);

  console.log(`Setting up patched Electron ${PATCH_VERSION} from:`);
  console.log(`  ${downloadUrl}`);

  await downloadFile(downloadUrl, tempZipPath);
  extractZip(tempZipPath, distDir);

  try { fs.unlinkSync(tempZipPath); } catch (_) {}

  fs.writeFileSync(pathTxt, platformPath, 'utf8');
  fs.writeFileSync(markerPath, `${PATCH_VERSION} patched from bigjakk/Electron-Websocket-Fix\nDate: ${new Date().toISOString()}\n`, 'utf8');

  if (process.platform !== 'win32' && fs.existsSync(exePath)) {
    try {
      fs.chmodSync(exePath, 0o755);
    } catch (_) {}
  }

  console.log(`Successfully installed patched Electron (${PATCH_VERSION})!`);
}

setup().catch(err => {
  console.error('Failed to setup patched Electron:', err);
  process.exit(1);
});
