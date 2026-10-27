import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
test('project defines all 16 issue categories',()=>{const m=app.match(/const CATS=\[(.*?)\];/);assert.ok(m);assert.equal((m[1].match(/,/g)||[]).length+1,16)});
test('missing or mismatched printed totals fall back to sums only after all 16 rows are read',()=>{assert.match(app,/function validate\(q\)/);assert.match(app,/q\.ok=complete&&\(!hasPrinted\|\|\(o===q\.sourceOcc&&p===q\.sourceProc\)\)/);assert.match(app,/q\.calculatedOcc=o/);assert.match(app,/r=>!r\.review/)});
test('duplicate fingerprint and unique database key exist',async()=>{assert.match(app,/SHA-256/);const schema=await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8');assert.match(schema,/image_hash.*unique|unique\s*\(image_hash\)/i)});
test('batch OCR is serialized through one worker',()=>{assert.match(app,/async function processQueue\(\)/);assert.match(app,/await ocr\(q,false\)/)});
test('reset, cross-trace, backlog warnings and aliases are present',()=>{for(const x of ['resetQueue','resetMonth','resetAll','undoLast','data-trace','warnpill','aliasModal'])assert.ok(app.includes(x),x)});

test('manual approval requires all rows reviewed and explicit user confirmation',()=>{assert.match(app,/function manualApprove\(id\)/);assert.match(app,/if\(!q\.rowsComplete\)/);assert.match(app,/if\(!confirm\(summary\)\)return/);assert.match(app,/manualApproved:true/)});
test('manual review button is disabled until all rows are complete',()=>{assert.match(app,/data-manual-approve=\"\$\{q\.id\}\" \$\{q\.rowsComplete&&!q\.ok\?'':'disabled'\}/)});
