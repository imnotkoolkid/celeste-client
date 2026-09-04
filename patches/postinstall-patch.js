/*
Electron Extraction Compatibility Fix

electron's built-in postinstall `install.js` downloads a zip and
extracts it using `extract-zip` which depends on `yauzl`
On some modern Node.js versions (Node 24.16.0+ / 26.1.0+) Node core stream changes break yauzl's
legacy streams, causing node install.js to exit with code 0 without extracting the binary

This script runs as a `postinstall` patch to ensure the Electron binary is reliably
extracted, regardless of the local Node.js version.

This is purely a development fix. Production bundles created by npm run build
(via electron-builder) fetch standalone packages independently and do not rely on this.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { downloadArtifact } = require('@electron/get');

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

function extractZip(zipPath, targetDir) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });

  if (process.platform === 'win32') {
    const psCommand = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${targetDir.replace(/'/g, "''")}' -Force`;
    execSync(`powershell -NoProfile -Command "${psCommand}"`, { stdio: 'inherit' });
  } else {
    try {
      execSync(`unzip -q -o "${zipPath}" -d "${targetDir}"`, { stdio: 'inherit' });
    } catch {
      try {
        execSync(`tar -xf "${zipPath}" -C "${targetDir}"`, { stdio: 'inherit' });
      } catch {
        execSync(`python3 -m zipfile -e "${zipPath}" "${targetDir}"`, { stdio: 'inherit' });
      }
    }
  }
}

async function setup() {
  const electronDir = path.resolve(__dirname, '..', 'node_modules', 'electron');
  const pkgPath = path.join(electronDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return;
  }

  const platformPath = getPlatformPath();
  const distDir = path.join(electronDir, 'dist');
  const pathTxt = path.join(electronDir, 'path.txt');
  const exePath = path.join(distDir, platformPath);

  if (fs.existsSync(exePath) && fs.existsSync(pathTxt)) {
    console.log('Electron binary is already installed.');
    return;
  }

  const version = require(pkgPath).version;
  const platform = process.env.npm_config_platform || process.platform;
  const arch = process.env.npm_config_arch || process.arch;
  console.log(`Downloading/locating Electron v${version}...`);

  const zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    platform,
    arch
  });

  console.log(`Extracting Electron binary to ${distDir}...`);
  extractZip(zipPath, distDir);

  fs.writeFileSync(pathTxt, platformPath, 'utf8');

  if (process.platform !== 'win32' && fs.existsSync(exePath)) {
    try {
      fs.chmodSync(exePath, 0o755);
    } catch (_) {}
  }

  console.log('Electron binary setup completed successfully.');
}

setup().catch(err => {
  console.error('Failed to setup Electron:', err);
  process.exit(1);
});