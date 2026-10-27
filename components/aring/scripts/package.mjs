import { execFileSync } from 'node:child_process';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
await mkdir('releases',{recursive:true});
const name='Aring-service-0.1.0.tar.gz';
execFileSync('tar',['-czf',`releases/${name}`,'package.json','package-lock.json','server','shared','web','test','dist','deploy','assets','scripts/build.mjs','README.md'],{stdio:'inherit'});
const digest=createHash('sha256').update(await readFile(`releases/${name}`)).digest('hex');
await writeFile('releases/SERVICE-SHA256SUMS.txt',`${digest}  ${name}\n`);console.log(`Saved releases/${name}`);
