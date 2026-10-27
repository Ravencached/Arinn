// Local artifact checks. Does not claim browser or Debian runtime validation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('./themes/ratataskr/styles.css');
const nginx = read('./server/nginx.conf');
const script = read('./server/setup-debian.sh');
assert(!css.includes('!important'), 'Theme must not force core overrides');
assert(!/https?:\/\//.test(css), 'Theme must not fetch external assets');
const vars = new Map([...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
function luminance(hex) {
  const rgb = hex.match(/[a-f\d]{2}/gi).map(x => parseInt(x, 16) / 255)
    .map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
for (const [fg, bg] of [
  ['--main-color', '--panel-bg-clr'],
  ['--input-clr', '--input-bg-clr'],
  ['--btn-clr', '--btn-success-bg-clr'],
  ['--folders-selected-color', '--folders-selected-bg-color'],
  ['--error-clr', '--error-bg-clr'],
  ['--warning-clr', '--warning-bg-clr'],
]) {
  const a = luminance(vars.get(fg)), b = luminance(vars.get(bg));
  const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  assert(ratio >= 4.5, `${fg}: contrast ${ratio}`);
  console.log(`${fg}: ${ratio.toFixed(2)}:1`);
}
const hash = path => createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex');
assert(readFileSync(new URL('./themes/ratataskr/images/logo.png',import.meta.url)).length>0, 'Local theme logo is included');
assert(nginx.includes('listen 127.0.0.1:8088;'));
assert(!/listen\s+(?:\[::\]:)?(?:80|443)\s*;/.test(nginx));
assert(nginx.includes('location = /index.php'));
assert(nginx.includes('^/(data|include\\.php)'));
assert(script.indexOf('systemctl mask nginx.service') < script.indexOf('apt-get install'));
assert(script.includes("define('APP_DATA_FOLDER_PATH', '/var/lib/ratataskr-snappymail/');"));
for (const file of ['./server/setup-debian.sh', './server/verify-debian.sh']) {
  assert(!read(file).includes('\r'), `${file} needs LF line endings`);
}
console.log('Artifact checks passed; Bash, Nginx/PHP and browser checks are separate.');
