import { startDiscord } from './discord.js';

const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'OWNER_IDS'];
const missing = required.filter(key => !process.env[key]);
if (missing.length) throw new Error('Missing required Discord settings: ' + missing.join(', '));

startDiscord();
console.log('Roblox Dev Desk is running in Discord command mode.');
