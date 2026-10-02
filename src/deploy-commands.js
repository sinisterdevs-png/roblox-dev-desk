import 'dotenv/config';
import { deployCommands } from './discord.js';
if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_CLIENT_ID) throw new Error('Set DISCORD_TOKEN and DISCORD_CLIENT_ID in .env first.');
await deployCommands();
console.log('Discord application commands deployed.');
