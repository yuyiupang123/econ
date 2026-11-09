import http from 'node:http';
import {database} from './database.mjs';
import {readFileSync} from 'node:fs';
import worker from '../dist/server/index.js';

const DB = database('.preview.sqlite');

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/_offline-preview') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(readFileSync('downloads/Economics-Escape-Room-Battle.html'));
      return;
    }
    const data = [];
    for await (const chunk of req) data.push(chunk);
    const request = new Request('http://127.0.0.1:' + (process.env.PORT || 4173) + req.url, {
      method: req.method,
      headers: req.headers,
      ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: Buffer.concat(data) } : {})
    });
    const response = await worker.fetch(request, { DB });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    console.error(e);
    res.writeHead(500);
    res.end('Preview error');
  }
});

// 讓 Render 可以透過環境變數 PORT 與 0.0.0.0 成功掃描到 Port
const PORT = process.env.PORT || 4173;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running at http://0.0.0.0:${PORT}`));
