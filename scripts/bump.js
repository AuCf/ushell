import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 1. Read current version from package.json
const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const currentVersion = pkg.version;

const arg = process.argv[2] || 'patch';
let newVersion = currentVersion;

if (arg === 'patch') {
  const parts = currentVersion.split('.').map(Number);
  parts[2] = (parts[2] || 0) + 1;
  newVersion = parts.join('.');
} else if (arg === 'minor') {
  const parts = currentVersion.split('.').map(Number);
  parts[1] = (parts[1] || 0) + 1;
  parts[2] = 0;
  newVersion = parts.join('.');
} else if (arg === 'major') {
  const parts = currentVersion.split('.').map(Number);
  parts[0] = (parts[0] || 0) + 1;
  parts[1] = 0;
  parts[2] = 0;
  newVersion = parts.join('.');
} else {
  newVersion = arg.replace(/^v/, '');
}

console.log(`🚀 Bumping version: v${currentVersion} ➔ v${newVersion}`);

// 2. Sync package.json
pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// 3. Sync tauri.conf.json
const tauriConfPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
if (fs.existsSync(tauriConfPath)) {
  const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
  tauriConf.version = newVersion;
  fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
}

// 4. Sync Cargo.toml
const cargoPath = path.join(rootDir, 'src-tauri', 'Cargo.toml');
if (fs.existsSync(cargoPath)) {
  let cargoContent = fs.readFileSync(cargoPath, 'utf8');
  cargoContent = cargoContent.replace(/^version\s*=\s*"[^"]+"/m, `version = "${newVersion}"`);
  fs.writeFileSync(cargoPath, cargoContent);
}

// 5. Sync docs/latest.json
const latestJsonPath = path.join(rootDir, 'docs', 'latest.json');
if (fs.existsSync(latestJsonPath)) {
  const latestJson = JSON.parse(fs.readFileSync(latestJsonPath, 'utf8'));
  latestJson.version = newVersion;
  latestJson.notes = `uShell v${newVersion} 自动热更新升级发布包。`;
  latestJson.pub_date = new Date().toISOString();
  if (latestJson.platforms) {
    if (latestJson.platforms['windows-x86_64']) {
      latestJson.platforms['windows-x86_64'].url = `https://github.com/AuCf/ushell/releases/download/v${newVersion}/uShell_${newVersion}_x64-setup.exe`;
    }
    if (latestJson.platforms['darwin-aarch64']) {
      latestJson.platforms['darwin-aarch64'].url = `https://github.com/AuCf/ushell/releases/download/v${newVersion}/uShell_${newVersion}_aarch64.dmg`;
    }
    if (latestJson.platforms['darwin-x86_64']) {
      latestJson.platforms['darwin-x86_64'].url = `https://github.com/AuCf/ushell/releases/download/v${newVersion}/uShell_${newVersion}_x64.dmg`;
    }
  }
  fs.writeFileSync(latestJsonPath, JSON.stringify(latestJson, null, 2) + '\n');
}

// 6. Sync docs/index.html version badge
const docsIndexPath = path.join(rootDir, 'docs', 'index.html');
if (fs.existsSync(docsIndexPath)) {
  let html = fs.readFileSync(docsIndexPath, 'utf8');
  html = html.replace(/\[v0\.\d+\.\d+\]/g, `[v${newVersion}]`);
  fs.writeFileSync(docsIndexPath, html);
}

console.log(`✅ All version files updated to v${newVersion}!`);

// 7. Auto Commit & Tag & Push
try {
  execSync('git add .', { cwd: rootDir, stdio: 'inherit' });
  execSync(`git commit -m "release: v${newVersion}"`, { cwd: rootDir, stdio: 'inherit' });
  execSync(`git tag -a v${newVersion} -m "Release uShell v${newVersion}"`, { cwd: rootDir, stdio: 'inherit' });
  execSync('git push origin master --tags', { cwd: rootDir, stdio: 'inherit' });
  console.log(`🎉 Successfully released and pushed tag v${newVersion} to GitHub! CI cloud build triggered!`);
} catch (e) {
  console.error('Git push failed:', e.message);
}
