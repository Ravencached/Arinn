import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await build({entryPoints:['web/app.mjs'],bundle:true,format:'esm',outfile:'dist/app.js',target:'es2022',minify:true});
for (const file of ['index.html','app.css','manifest.webmanifest','sw.js','icon.svg']) await copyFile(`web/${file}`,`dist/${file}`);
await copyFile('assets/logo.png','dist/logo.png');
const sw = await readFile('dist/sw.js','utf8');
await writeFile('dist/sw.js',sw.replace('BUILD_VERSION',`aring-${Date.now()}`));
console.log('Áring web bundle built.');
