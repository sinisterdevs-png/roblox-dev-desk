# Roblox Dev Desk

A Discord bot plus owner dashboard for Roblox creator communities. Developers submit products with a guided Discord form; owners configure products and review, approve, request changes, or reject submissions from the dashboard.

## Features

- `/submit`: choose a product, answer configurable questions, and attach images, video, or a Roblox link. The guided form supports up to five custom questions per product, with the rest captured in the submission checklist.
- `/products`, `/mysubmissions`, `/help`: browse open products, track decisions, and see how the workflow works.
- Product setup in the dashboard: create, edit, publish, archive, set category, price/model, Roblox URL, review criteria, and custom questions.
- Review queue: search/filter submissions, open full details and attachments, assign a reviewer, add private notes, request changes, approve, or reject.
- Decision DMs and configurable Discord submission/review-log channels.
- JSON persistence for a small community starter. Keep `data/store.json` backed up; for a larger community migrate `src/store.js` to Postgres.
- Dashboard authentication, secure headers, rate limits, CSRF checks, role-gated owner actions, and no public bot-token exposure.

## Run it

1. Install Node.js 20 or newer.
2. Create a Discord application and bot in the [Discord Developer Portal](https://discord.com/developers/applications). Copy the bot token and application ID into `.env`. Invite it with `bot` and `applications.commands` scopes and permission to send messages, embeds, and DMs.
3. Copy `.env.example` to `.env`. Set a long dashboard password and session secret. Add your Discord user ID(s) to `OWNER_IDS`, comma separated. `DISCORD_GUILD_ID` is recommended for fast command updates while developing.
4. Install dependencies locally and deploy the slash commands once (guild commands appear faster than global ones):

   ```powershell
   npm install
   npm run deploy-commands
   npm start
   ```

5. Start the app with `npm start`. Open `http://localhost:3000` and sign in with `DASHBOARD_USER` and `DASHBOARD_PASSWORD`.
6. Create a product and publish it. Developers can then run `/submit` in the server.

## NexusHost deployment

NexusHost documents Node.js/discord.js support, GitHub deployment, environment variables, and custom subdomains for a bot web server. Connect the repository in its dashboard, choose the `main` branch, use `npm start` as the start command, and add the `.env.example` variables as server environment variables. Set `DASHBOARD_URL` to the HTTPS subdomain NexusHost assigns and `PORT` to its assigned port if the panel requires it. The server binds to `0.0.0.0` for the dashboard. Keep the `data/` directory persistent across redeploys/restarts because it contains product and submission records. Confirm storage persistence and public web-port/subdomain settings in your server panel before launch. [NexusHost language/runtime guide](https://www.nexushost.app/languages) · [NexusHost documentation](https://www.nexushost.app/docs)

Do not commit `.env`. This starter uses Discord's built-in attachment CDN URLs; for durable media retention, move uploads to object storage before launch.

## Submission checklist

Developers provide a product name, Roblox experience or catalog link, description, up to five owner-configured answers, screenshots/video files attached to `/submit` (two images and one clip) or video URLs, price/revenue split, testing details, moderation and performance notes, and an originality/rights confirmation. Owners can edit criteria per product in the dashboard.

## Discord setup notes

Use a private submissions/review channel and give it access only to owners/reviewers. Set `SUBMISSIONS_CHANNEL_ID` to that channel; it receives a review card with dashboard link. `REVIEW_LOG_CHANNEL_ID` is optional. Discord DMs can be disabled by a user, so the dashboard remains the source of truth. The app only reads interaction data and attachment metadata; it does not request message-content access.

## Before a public production launch

Add a database with backups, HTTPS/reverse proxy, multi-owner roles, persistent media storage, and a retention policy. The starter keeps reviewer-only notes on your server and never includes them in developer decision DMs.
