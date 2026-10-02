import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, GatewayIntentBits, ModalBuilder, REST, Routes, SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { db } from './store.js';

const owners = new Set((process.env.OWNER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean));
const active = new Map();
const support = new SlashCommandBuilder().setName('help').setDescription('How product review works');
const list = new SlashCommandBuilder().setName('products').setDescription('Browse products currently accepting submissions');
const mine = new SlashCommandBuilder().setName('mysubmissions').setDescription('See your product submission status');
const submit = new SlashCommandBuilder().setName('submit').setDescription('Submit a Roblox product for owner review')
  .addStringOption(o => o.setName('product').setDescription('Select the product type for review').setRequired(true).setAutocomplete(true))
  .addAttachmentOption(o => o.setName('screenshot1').setDescription('Attach a product screenshot').setRequired(false))
  .addAttachmentOption(o => o.setName('screenshot2').setDescription('Attach another screenshot').setRequired(false))
  .addAttachmentOption(o => o.setName('video').setDescription('Attach a short product video').setRequired(false));
export const commandDefinitions = [support, list, mine, submit].map(c => c.toJSON());

export async function deployCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const route = process.env.DISCORD_GUILD_ID ? Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID) : Routes.applicationCommands(process.env.DISCORD_CLIENT_ID);
  await rest.put(route, { body: commandDefinitions });
}

export function startDiscord() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.on('interactionCreate', async interaction => {
    try {
      if (interaction.isAutocomplete()) {
        const term = interaction.options.getFocused().toLowerCase();
        return interaction.respond(db.products().filter(p => p.title.toLowerCase().includes(term)).slice(0, 25).map(p => ({ name: `${p.title} · ${p.category}`.slice(0, 100), value: p.id })));
      }
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'products') {
          const products = db.products();
          return interaction.reply({ ephemeral: true, embeds: [new EmbedBuilder().setColor(0x9a7bff).setTitle('Open product reviews').setDescription(products.length ? products.map(p => `**${p.title}** · ${p.category}\n${p.summary}`).join('\n\n').slice(0, 4000) : 'No products are accepting submissions right now.')] });
        }
        if (interaction.commandName === 'help') return interaction.reply({ ephemeral: true, content: '**Roblox Dev Desk**\n`/products` browse open reviews · `/submit` start a review · `/mysubmissions` check decisions. Add screenshots/video files to the `/submit` command, then include your Roblox link, product details, price, testing notes, and any demo/video URLs. Owners review in the dashboard and can approve, reject, or request changes.' });
        if (interaction.commandName === 'mysubmissions') {
          const mine = db.all().submissions.filter(s => s.userId === interaction.user.id);
          return interaction.reply({ ephemeral: true, content: mine.length ? mine.slice(0, 10).map(s => `**${s.title}** — ${s.status}${s.decisionNote ? `\n> ${s.decisionNote}` : ''}`).join('\n\n') : 'You have not submitted a product yet. Use `/submit` to get started.' });
        }
        if (interaction.commandName === 'submit') {
          const product = db.product(interaction.options.getString('product'));
          if (!product || product.status !== 'published') return interaction.reply({ ephemeral: true, content: 'That review is closed. Use `/products` to see open reviews.' });
          active.set(interaction.user.id, { productId: product.id, step: 0, answers: {}, attachments: ['screenshot1', 'screenshot2', 'video'].map(name => interaction.options.getAttachment(name)).filter(Boolean).map(a => ({ url: a.url, name: a.name, contentType: a.contentType })) });
          return interaction.reply({ ephemeral: true, embeds: [new EmbedBuilder().setColor(0x9a7bff).setTitle(`Submit: ${product.title}`).setDescription(`**Review criteria**\n${product.criteria.length ? product.criteria.map(x => `• ${x}`).join('\n') : 'Owners will assess quality, originality, polish, and community fit.'}\n\nAttach screenshots or a short video to this command. I’ll ask a few questions and collect product details next. By starting, you confirm you have the right to submit this work and its media.`)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('submission:start').setLabel('Agree & start').setStyle(ButtonStyle.Primary))] });
        }
      }
      if (interaction.isButton() && interaction.customId === 'submission:start') {
        const flow = active.get(interaction.user.id); if (!flow) return interaction.reply({ ephemeral: true, content: 'Start again with `/submit`.' });
        const product = db.product(flow.productId); const q = product?.questions ?? [];
        if (!q.length) return showFinalForm(interaction, flow, product);
        return showQuestion(interaction, flow, product);
      }
      if (interaction.isButton() && interaction.customId === 'submission:next') {
        const flow = active.get(interaction.user.id); if (!flow) return interaction.reply({ ephemeral: true, content: 'Start again with `/submit`.' });
        const modal = new ModalBuilder().setCustomId(`answer:${interaction.user.id}`).setTitle('Product review question');
        const product = db.product(flow.productId); const q = product.questions[flow.step];
        const input = new TextInputBuilder().setCustomId('value').setLabel(q.label.slice(0, 45)).setStyle(q.long ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(q.required !== false).setMaxLength(1000);
        modal.addComponents(new ActionRowBuilder().addComponents(input)); return interaction.showModal(modal);
      }
      if (interaction.isModalSubmit() && interaction.customId.startsWith('answer:')) {
        const flow = active.get(interaction.user.id); if (!flow) return interaction.reply({ ephemeral: true, content: 'This form expired. Start again with `/submit`.' });
        const product = db.product(flow.productId); flow.answers[product.questions[flow.step].label] = interaction.fields.getTextInputValue('value'); flow.step++;
        if (flow.step >= product.questions.length) return showFinalForm(interaction, flow, product);
        const embed = new EmbedBuilder().setColor(0x9a7bff).setTitle(`Question ${flow.step + 1} of ${product.questions.length}`).setDescription(product.questions[flow.step].label);
        return interaction.reply({ ephemeral: true, embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('submission:next').setLabel('Answer').setStyle(ButtonStyle.Primary))] });
      }
      if (interaction.isModalSubmit() && interaction.customId.startsWith('final:')) {
        const flow = active.get(interaction.user.id); if (!flow) return interaction.reply({ ephemeral: true, content: 'This form expired. Start again with `/submit`.' });
        const product = db.product(flow.productId);
        const testNotes = interaction.fields.getTextInputValue('testing');
        const links = testNotes.match(/https?:\/\/[^\s]+/g) ?? [];
        const submission = db.createSubmission({ productId: product.id, productTitle: product.title, userId: interaction.user.id, username: interaction.user.username, title: interaction.fields.getTextInputValue('title'), robloxUrl: interaction.fields.getTextInputValue('roblox'), description: interaction.fields.getTextInputValue('description'), price: interaction.fields.getTextInputValue('price'), testNotes, rightsConfirmed: true, answers: flow.answers, attachments: [...flow.attachments, ...links.slice(0, 8).map(url => ({ url, name: 'Video or demo link' }))] });
        active.delete(interaction.user.id);
        const channel = process.env.SUBMISSIONS_CHANNEL_ID ? await client.channels.fetch(process.env.SUBMISSIONS_CHANNEL_ID).catch(() => null) : null;
        if (channel?.isTextBased()) { const dashboard = process.env.DASHBOARD_URL; await channel.send({ embeds: [submissionEmbed(submission)], ...(dashboard ? { components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Open owner dashboard').setStyle(ButtonStyle.Link).setURL(`${dashboard.replace(/\/$/, '')}/?submission=${submission.id}`))] } : {}) }).catch(() => {}); }
        return interaction.reply({ ephemeral: true, content: `Submission **${submission.title}** received. Owners will review it and update you here or by DM. Reference: ${submission.id.slice(0, 8)}` });
      }
    } catch (error) { console.error('Discord interaction error:', error); if (!interaction.replied && !interaction.deferred) await interaction.reply({ ephemeral: true, content: 'Something went wrong. Please try again or contact an owner.' }).catch(() => {}); }
  });
  client.once('ready', () => console.log(`Discord connected as ${client.user.tag}`));
  client.login(process.env.DISCORD_TOKEN);
  return client;
}

function showQuestion(interaction, flow, product) {
  const q = product.questions[flow.step];
  return interaction.reply({ ephemeral: true, embeds: [new EmbedBuilder().setColor(0x9a7bff).setTitle(`Question ${flow.step + 1} of ${product.questions.length}`).setDescription(q.label)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('submission:next').setLabel('Answer').setStyle(ButtonStyle.Primary))] });
}
function showFinalForm(interaction, flow, product) {
  const modal = new ModalBuilder().setCustomId(`final:${interaction.user.id}`).setTitle('Product details');
  const short = (id, label, required = true) => new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(required).setMaxLength(250);
  modal.addComponents(
    new ActionRowBuilder().addComponents(short('title', 'Product / experience name')),
    new ActionRowBuilder().addComponents(short('roblox', 'Roblox product URL')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('What does it do? Who is it for?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)),
    new ActionRowBuilder().addComponents(short('price', 'Price / revenue split', false)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('testing').setLabel('Testing notes + media URLs (screenshots/video)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000))
  );
  return interaction.showModal(modal);
}
export function submissionEmbed(s) {
  return new EmbedBuilder().setColor(0xffc857).setTitle(`New submission · ${s.title}`).setDescription(s.description.slice(0, 800)).addFields({ name: 'Developer', value: `<@${s.userId}>`, inline: true }, { name: 'Product', value: s.productTitle, inline: true }, { name: 'Status', value: s.status, inline: true }, { name: 'Roblox link', value: s.robloxUrl || 'Not provided' });
}
export async function sendDecision(client, submission, actor, note) {
  const user = await client.users.fetch(submission.userId).catch(() => null);
  if (user) await user.send(`**Update on ${submission.title}: ${submission.status.toUpperCase()}**${note ? `\n\n${note}` : ''}\n\nUse `/mysubmissions` in the server to check your submission.`).catch(() => {});
  if (process.env.REVIEW_LOG_CHANNEL_ID) {
    const channel = await client.channels.fetch(process.env.REVIEW_LOG_CHANNEL_ID).catch(() => null);
    if (channel?.isTextBased()) await channel.send({ embeds: [new EmbedBuilder().setColor(submission.status === 'approved' ? 0x35c997 : submission.status === 'rejected' ? 0xff6877 : 0x9a7bff).setTitle(`${submission.status.toUpperCase()} · ${submission.title}`).setDescription(note || 'No message added').addFields({ name: 'Developer', value: `<@${submission.userId}>`, inline: true }, { name: 'Reviewer', value: `<@${actor}>`, inline: true })] }).catch(() => {});
  }
}
