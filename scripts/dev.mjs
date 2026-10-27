import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'};
createServer(async(req,res)=>{try{let p=normalize(decodeURIComponent((req.url||'/').split('?')[0])); if(p==='/'||p==='\\')p='/index.html'; const data=await readFile(join(process.cwd(),p));res.writeHead(200,{'Content-Type':types[extname(p)]||'application/octet-stream'});res.end(data)}catch{res.writeHead(404);res.end('Not found')}}).listen(4173,()=>console.log('QT Report Aggregator at http://localhost:4173'));
