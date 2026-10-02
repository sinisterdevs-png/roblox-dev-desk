import { createServer } from 'node:http';
import { startDiscord } from './discord.js';

const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'OWNER_IDS'];
const missing = required.filter(key => !process.env[key]);
if (missing.length) throw new Error('Missing required Discord settings: ' + missing.join(', '));

startDiscord();

const port = Number(process.env.PORT || 3000);
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  if (req.url === '/health') {
    res.writeHead(200);
    return res.end('ok\n');
  }
  if (req.url === '/' || req.url === '/status') {
    res.writeHead(200);
    return res.end('Roblox Dev Desk bot is online. The web dashboard is paused; use Discord slash commands.\n');
  }
  res.writeHead(404);
  res.end('Not found.\n');
});
server.on('error', error => {
  console.error('Health server error:', error);
  process.exitCode = 1;
});
server.listen(port, '0.0.0.0', () => {
  console.log('Health endpoint listening on ' + port + '. Web dashboard paused.');
});
