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
const createProduct = new SlashCommandBuilder().setName('product-create').setDescription('Create a product review form')
  .addStringOption(o => o.setName('name').setDescription('Product name').setRequired(true).setMaxLength(80))
  .addStringOption(o => o.setName('category').setDescription('Category').setRequired(true).setMaxLength(40))
  .addStringOption(o => o.setName('summary').setDescription('Submission instructions').setRequired(true).setMaxLength(300))
  .addStringOption(o => o.setName('questions').setDescription('Optional questions, one per line (max 5)').setRequired(false).setMaxLength(250))
  .addStringOption(o => o.setName('criteria').setDescription('Optional review criteria, one per line').setRequired(false).setMaxLength(1000));
const productStatus = new SlashCommandBuilder().setName('product-status').setDescription('Open, pause, or archive a review form')
  .addStringOption(o => o.setName('product').setDescription('Review form').setRequired(true).setAutocomplete(true))
  .addStringOption(o => o.setName('status').setDescription('New status').setRequired(true).addChoices({ name: 'Accepting submissions', value: 'published' }, { name: 'Draft', value: 'draft' }, { name: 'Archived', value: 'archived' }));
const productList = new SlashCommandBuilder().setName('product-list').setDescription('List all review forms');
const reviewQueue = new SlashCommandBuilder().setName('review').setDescription('Review pending developer submissions');
const panel = new SlashCommandBuilder().setName('panel').setDescription('Open the interactive developer and owner panel');
export const commandDefinitions = [support, list, mine, submit, createProduct, productStatus, productList, reviewQueue, panel].map(c => c.toJSON());

export async function deployCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const route = process.env.DISCORD_GUILD_ID ? Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID) : Routes.applicationCommands(process.env.DISCORD_CLIENT_ID);
  await rest.put(route, { body: commandDefinitions });
}


function panelHome(userId) {
  const rows = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:browse').setLabel('Browse products').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel:submit').setLabel('Start a submission').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('panel:mine').setLabel('My submissions').setStyle(ButtonStyle.Secondary)
  )];
  if (owners.has(userId)) rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:manage').setLabel('Manage products').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:create').setLabel('Create review form').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel:review').setLabel('Review queue').setStyle(ButtonStyle.Danger)
  ));
  return {
    embeds: [new EmbedBuilder().setColor(0x9a7bff).setTitle('Roblox Dev Desk').setDescription(
      'Choose an action below. Developers can browse review forms, submit a product, and check decisions here. Owners can create forms, manage their status, and review submissions.\n\nFor screenshots or direct video attachments, use the submit command; the panel submission flow accepts media links in its final form.'
    )],
    components: rows
  };
}
function panelBackRow() {
  return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('panel:home').setLabel('Back to panel').setStyle(ButtonStyle.Secondary));
}

export function startDiscord() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.on('interactionCreate', async interaction => {
    try {
      if (interaction.isAutocomplete()) {
        const term = interaction.options.getFocused().toLowerCase();
        const available = interaction.commandName === 'product-status' ? db.products(true) : db.products();
        return interaction.respond(available.filter(p => p.title.toLowerCase().includes(term)).slice(0, 25).map(p => ({ name: (p.title + ' · ' + (p.status || p.category)).slice(0, 100), value: p.id })));
      }
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'panel') return interaction.reply({ ephemeral: true, ...panelHome(interaction.user.id) });
        if (interaction.commandName === 'products') {
          const products = db.products();
          return interaction.reply({ ephemeral: true, embeds: [new EmbedBuilder().setColor(0x9a7bff).setTitle('Open product reviews').setDescription(products.length ? products.map(p => `**${p.title}** · ${p.category}\n${p.summary}`).join('\n\n').slice(0, 4000) : 'No products are accepting submissions right now.')] });
        }
        if (interaction.commandName === 'help') return interaction.reply({ ephemeral: true, content: '**Roblox Dev Desk**\nDeveloper commands: /products, /submit, /mysubmissions. Owner commands: /product-create, /product-list, /product-status, /review. Manage forms and submission decisions in Discord.' });
        if (interaction.commandName === 'mysubmissions') {
          const mine = db.all().submissions.filter(s => s.userId === interaction.user.id);
          return interaction.reply({ ephemeral: true, content: mine.length ? mine.slice(0, 10).map(s => `**${s.title}** — ${s.status}${s.decisionNote ? `\n> ${s.decisionNote}` : ''}`).join('\n\n') : 'You have not submitted a product yet. Use `/submit` to get started.' });
        }
        if (interaction.commandName === 'product-create') {
          if (!owners.has(interaction.user.id)) return interaction.reply({ ephemeral: true, content: 'This command is for bot owners only.' });
          const questions = (interaction.options.getString('questions') || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, 5).map(label => ({ label: label.slice(0, 45), long: true, required: true }));
          const criteria = (interaction.options.getString('criteria') || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, 12).map(x => x.slice(0, 140));
          const product = db.upsertProduct({ title: interaction.options.getString('name', true).trim(), category: interaction.options.getString('category', true).trim(), summary: interaction.options.getString('summary', true).trim(), questions, criteria, status: 'published' });
          return interaction.reply({ ephemeral: true, content: 'Created and opened **' + product.title + '**. Developers can now use /products and /submit.' });
        }
        if (interaction.commandName === 'product-list') {
          if (!owners.has(interaction.user.id)) return interaction.reply({ ephemeral: true, content: 'This command is for bot owners only.' });
          const items = db.products(true);
          return interaction.reply({ ephemeral: true, content: items.length ? items.slice(0, 20).map(p => '**' + p.title + '** · ' + p.status + ' · ' + p.category + ' · ID ' + p.id).join('\n') : 'No review forms yet. Create one with /product-create.' });
        }
        if (interaction.commandName === 'product-status') {
          if (!owners.has(interaction.user.id)) return interaction.reply({ ephemeral: true, content: 'This command is for bot owners only.' });
          const product = db.product(interaction.options.getString('product', true));
          if (!product) return interaction.reply({ ephemeral: true, content: 'Review form not found. Run /product-list and try again.' });
          const status = interaction.options.getString('status', true);
          db.upsertProduct({ ...product, status });
          return interaction.reply({ ephemeral: true, content: '**' + product.title + '** is now **' + status + '**.' });
        }
        if (interaction.commandName === 'review') {
          if (!owners.has(interaction.user.id)) return interaction.reply({ ephemeral: true, content: 'This command is for bot owners only.' });
          const items = db.all().submissions.filter(s => ['pending', 'in_review', 'changes_requested'].includes(s.status)).slice(0, 25);
          if (!items.length) return interaction.reply({ ephemeral: true, content: 'There are no submissions waiting for review.' });
          const menu = new StringSelectMenuBuilder().setCustomId('review:select').setPlaceholder('Choose a submission').addOptions(items.map(s => ({ label: s.title.slice(0, 100), description: (s.productTitle + ' · ' + s.username + ' · ' + s.status).slice(0, 100), value: s.id })));
          return interaction.reply({ ephemeral: true, content: 'Select a submission to review. You can approve, reject, or request changes.', components: [new ActionRowBuilder().addComponents(menu)] });
        }
        if (interaction.commandName === 'submit') {
          const product = db.product(interaction.options.getString('product'));
          if (!product || product.status !== 'published') return interaction.reply({ ephemeral: true, content: 'That review is closed. Use `/products` to see open reviews.' });
          active.set(interaction.user.id, { productId: product.id, step: 0, answers: {}, attachments: ['screenshot1', 'screenshot2', 'video'].map(name => interaction.options.getAttachment(name)).filter(Boolean).map(a => ({ url: a.url, name: a.name, contentType: a.contentType })) });
          return interaction.reply({ ephemeral: true, embeds: [new EmbedBuilder().setColor(0x9a7bff).setTitle(`Submit: ${product.title}`).setDescription(`**Review criteria**\n${product.criteria.length ? product.criteria.map(x => `• ${x}`).join('\n') : 'Owners will assess quality, originality, polish, and community fit.'}\n\nAttach screenshots or a short video to this command. I’ll ask a few questions and collect product details next. By starting, you confirm you have the right to submit this work and its media.`)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('submission:start').setLabel('Agree & start').setStyle(ButtonStyle.Primary))] });
        }
      }

      if (interaction.isButton() && interaction.customId.startsWith('panel:')) {
        const action = interaction.customId.slice('panel:'.length);
        if (action === 'home') return interaction.update(panelHome(interaction.user.id));
        if (action === 'browse' || action === 'submit') {
          const items = db.products().filter(p => p.status === 'published').slice(0, 25);
          if (!items.length) return interaction.update({ content: 'There are no open review forms yet.', embeds: [], components: [panelBackRow()] });
          const menu = new StringSelectMenuBuilder().setCustomId('panel:product').setPlaceholder('Choose a product review').addOptions(items.map(p => ({ label: p.title.slice(0, 100), description: (p.category + ' · ' + p.summary).slice(0, 100), value: p.id })));
          return interaction.update({ content: 'Choose a review form. You can attach screenshots or videos later with the submit command.', embeds: [], components: [new ActionRowBuilder().addComponents(menu), panelBackRow()] });
        }
        if (action === 'mine') {
          const items = db.all().submissions.filter(x => x.userId === interaction.user.id).slice(0, 10);
          const text = items.length ? items.map(x => '**' + x.title + '** — ' + x.status + (x.decisionNote ? '\n> ' + x.decisionNote : '')).join('\n\n').slice(0, 3900) : 'You have not submitted a product yet.';
          return interaction.update({ embeds: [new EmbedBuilder().setColor(0x9a7bff).setTitle('My submissions').setDescription(text)], components: [panelBackRow()] });
        }
        if (action === 'manage' || action === 'create' || action === 'review') {
          if (!owners.has(interaction.user.id)) return interaction.reply({ ephemeral: true, content: 'This panel is for bot owners only.' });
          if (action === 'create') {
            const modal = new ModalBuilder().setCustomId('panel:create-product').setTitle('Create a review form');
            modal.addComponents(
              new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Product or review name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)),
              new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('category').setLabel('Category').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40)),
              new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('summary').setLabel('Submission instructions').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(300)),
              new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('questions').setLabel('Optional questions, one per line').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(250)),
              new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('criteria').setLabel('Optional review criteria, one per line').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000))
            );
            return interaction.showModal(modal);
          }
          if (action === 'manage') {
            const items = db.products(true).slice(0, 25);
            if (!items.length) return interaction.update({ content: 'No review forms yet. Use Create review form to add one.', embeds: [], components: [panelBackRow()] });
            const menu = new StringSelectMenuBuilder().setCustomId('panel:manage-product').setPlaceholder('Choose a review form').addOptions(items.map(p => ({ label: p.title.slice(0, 100), description: (p.category + ' · ' + p.status).slice(0, 100), value: p.id })));
            return interaction.update({ content: 'Choose a form to open, pause, or archive.', embeds: [], components: [new ActionRowBuilder().addComponents(menu), panelBackRow()] });
          }
          const items = db.all().submissions.filter(x => ['pending', 'in_review', 'changes_requested'].includes(x.status)).slice(0, 25);
          if (!items.length) return interaction.update({ content: 'There are no submissions waiting for review.', embeds: [], components: [panelBackRow()] });
          const menu = new StringSelectMenuBuilder().setCustomId('review:select').setPlaceholder('Choose a submission').addOptions(items.map(x => ({ label: x.title.slice(0, 100), description: (x.productTitle + ' · ' + x.username + ' · ' + x.status).slice(0, 100), value: x.id })));
          return interaction.update({ content: 'Choose a submission to review.', embeds: [], components: [new ActionRowBuilder().addComponents(menu), panelBackRow()] });
        }
        if (action.startsWith('submit:')) {
          const item = db.product(action.slice('submit:'.length));
          if (!item || item.status !== 'published') return interaction.update({ content: 'That review form is closed.', embeds: [], components: [panelBackRow()] });
          active.set(interaction.user.id, { productId: item.id, step: 0, answers: {}, attachments: [] });
          const criteria = item.criteria?.length ? item.criteria.map(x => '• ' + x).join('\n') : 'Owners will assess quality, originality, polish, and community fit.';
          return interaction.update({ content: '', embeds: [new EmbedBuilder().setColor(0x9a7bff).setTitle('Submit: ' + item.title).setDescription('**Review criteria**\n' + criteria + '\n\nBy starting, you confirm you have the right to submit this work and its media. Add screenshots or videos as links in the final form, or use the submit command to attach files.')], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('submission:start').setLabel('Agree & start').setStyle(ButtonStyle.Primary)), panelBackRow()] });
        }
        if (action.startsWith('status:')) {
          if (!owners.has(interaction.user.id)) return interaction.reply({ ephemeral: true, content: 'This action is for bot owners only.' });
          const parts = action.split(':');
          const status = parts[1];
          const id = parts.slice(2).join(':');
          const item = db.product(id);
          if (!item) return interaction.update({ content: 'Review form not found.', embeds: [], components: [panelBackRow()] });
          db.upsertProduct({ ...item, status });
          return interaction.update({ content: '**' + item.title + '** is now **' + status + '**.', embeds: [], components: [panelBackRow()] });
        }
      }
      if (interaction.isStringSelectMenu() && interaction.customId === 'panel:product') {
        const item = db.product(interaction.values[0]);
        if (!item || item.status !== 'published') return interaction.update({ content: 'That review form is closed.', embeds: [], components: [panelBackRow()] });
        const embed = new EmbedBuilder().setColor(0x9a7bff).setTitle(item.title).setDescription((item.summary || 'Open for submissions.') + '\n\n**Category:** ' + item.category + (item.criteria?.length ? '\n\n**Review criteria**\n' + item.criteria.map(x => '• ' + x).join('\n') : ''));
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('panel:submit:' + item.id).setLabel('Start submission').setStyle(ButtonStyle.Success));
        return interaction.update({ content: '', embeds: [embed], components: [row, panelBackRow()] });
      }
      if (interaction.isStringSelectMenu() && interaction.customId === 'panel:manage-product') {
        if (!owners.has(interaction.user.id)) return interaction.reply({ ephemeral: true, content: 'This action is for bot owners only.' });
        const item = db.product(interaction.values[0]);
        if (!item) return interaction.update({ content: 'Review form not found.', embeds: [], components: [panelBackRow()] });
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('panel:status:published:' + item.id).setLabel('Open').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('panel:status:draft:' + item.id).setLabel('Pause').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('panel:status:archived:' + item.id).setLabel('Archive').setStyle(ButtonStyle.Danger)
        );
        return interaction.update({ content: '**' + item.title + '** · ' + item.category + ' · currently **' + item.status + '**', embeds: [], components: [row, panelBackRow()] });
      }
      if (interaction.isStringSelectMenu() && interaction.customId === 'review:select') {
        if (!owners.has(interaction.user.id)) return interaction.reply({ ephemeral: true, content: 'This action is for bot owners only.' });
        const item = db.submission(interaction.values[0]);
        if (!item) return interaction.update({ content: 'Submission not found.', embeds: [], components: [] });
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('review:approve:' + item.id).setLabel('Approve').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('review:changes:' + item.id).setLabel('Request changes').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('review:reject:' + item.id).setLabel('Reject').setStyle(ButtonStyle.Danger)
        );
        return interaction.update({ content: 'Submission review', embeds: [submissionEmbed(item)], components: [row] });
      }
      if (interaction.isButton() && interaction.customId.startsWith('review:')) {
        if (!owners.has(interaction.user.id)) return interaction.reply({ ephemeral: true, content: 'This action is for bot owners only.' });
        const parts = interaction.customId.split(':');
        const action = parts[1];
        const id = parts.slice(2).join(':');
        const item = db.submission(id);
        if (!item) return interaction.reply({ ephemeral: true, content: 'Submission not found.' });
        if (action === 'approve') {
          const updated = db.updateSubmission(id, { status: 'approved', reviewerId: interaction.user.id, decisionNote: '' });
          await sendDecision(client, updated, interaction.user.id, '');
          return interaction.update({ content: 'Approved **' + item.title + '** and notified the developer.', embeds: [], components: [] });
        }
        const status = action === 'reject' ? 'rejected' : 'changes_requested';
        const modal = new ModalBuilder().setCustomId('review-note:' + status + ':' + id).setTitle(action === 'reject' ? 'Reject submission' : 'Request changes');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('note').setLabel('Message to developer').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)));
        return interaction.showModal(modal);
      }
      if (interaction.isModalSubmit() && interaction.customId === 'panel:create-product') {
        if (!owners.has(interaction.user.id)) return interaction.reply({ ephemeral: true, content: 'This action is for bot owners only.' });
        const questions = interaction.fields.getTextInputValue('questions').split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, 5).map(label => ({ label: label.slice(0, 45), long: true, required: true }));
        const criteria = interaction.fields.getTextInputValue('criteria').split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, 12).map(x => x.slice(0, 140));
        const item = db.upsertProduct({ title: interaction.fields.getTextInputValue('name').trim(), category: interaction.fields.getTextInputValue('category').trim(), summary: interaction.fields.getTextInputValue('summary').trim(), questions, criteria, status: 'published' });
        return interaction.reply({ ephemeral: true, content: 'Created and published **' + item.title + '**. Developers can now find it in the panel.' });
      }
      if (interaction.isModalSubmit() && interaction.customId.startsWith('review-note:')) {
        if (!owners.has(interaction.user.id)) return interaction.reply({ ephemeral: true, content: 'This action is for bot owners only.' });
        const parts = interaction.customId.split(':');
        const status = parts[1];
        const id = parts.slice(2).join(':');
        const item = db.submission(id);
        if (!item) return interaction.reply({ ephemeral: true, content: 'Submission not found.' });
        const note = interaction.fields.getTextInputValue('note');
        const updated = db.updateSubmission(id, { status, reviewerId: interaction.user.id, decisionNote: note });
        await sendDecision(client, updated, interaction.user.id, note);
        return interaction.reply({ ephemeral: true, content: 'Sent ' + status.replace('_', ' ') + ' to ' + updated.title + ' and notified the developer.' });
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
        const product = db.product(flow.productId); const q = product?.questions?.[flow.step];
        if (!q) { active.delete(interaction.user.id); return interaction.reply({ ephemeral: true, content: 'This submission form is no longer available. Start again with `/submit`.' }); }
        const input = new TextInputBuilder().setCustomId('value').setLabel(q.label.slice(0, 45)).setStyle(q.long ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(q.required !== false).setMaxLength(1000);
        modal.addComponents(new ActionRowBuilder().addComponents(input)); return interaction.showModal(modal);
      }
      if (interaction.isModalSubmit() && interaction.customId.startsWith('answer:')) {
        const flow = active.get(interaction.user.id); if (!flow) return interaction.reply({ ephemeral: true, content: 'This form expired. Start again with `/submit`.' });
        const product = db.product(flow.productId); const question = product?.questions?.[flow.step];
        if (!question) { active.delete(interaction.user.id); return interaction.reply({ ephemeral: true, content: 'This submission form is no longer available. Start again with `/submit`.' }); }
        flow.answers[question.label] = interaction.fields.getTextInputValue('value'); flow.step++;
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
  client.once('ready', async () => {
    console.log(`Discord connected as ${client.user.tag}`);
    try { await deployCommands(); console.log('Discord slash commands deployed.'); }
    catch (error) { console.error('Could not deploy slash commands:', error); }
  });
  client.login(process.env.DISCORD_TOKEN);
  return client;
}

function showQuestion(interaction, flow, product) {
  const q = product?.questions?.[flow.step];
  if (!q) { active.delete(interaction.user.id); return interaction.reply({ ephemeral: true, content: 'This submission form is no longer available. Start again with `/submit`.' }); }
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
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('testing').setLabel('Testing notes and media links').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000))
  );
  return interaction.showModal(modal);
}
export function submissionEmbed(s) {
  const answers = Object.entries(s.answers ?? {}).map(([key, value]) => '**' + key + '**\n' + value).join('\n\n');
  const files = (s.attachments ?? []).map(a => '[' + (a.name || 'Attachment') + '](' + a.url + ')').join('\n');
  const details = [
    '**Description**\n' + (s.description || 'Not provided'),
    '**Price / split**\n' + (s.price || 'Not specified'),
    '**Testing notes**\n' + (s.testNotes || 'None'),
    answers ? '**Product questions**\n' + answers : '',
    files ? '**Screenshots and videos**\n' + files : ''
  ].filter(Boolean).join('\n\n').slice(0, 4000);
  return new EmbedBuilder().setColor(0xffc857).setTitle('Submission · ' + String(s.title || 'Untitled').slice(0, 240)).setDescription(details)
    .addFields(
      { name: 'Developer', value: '<@' + s.userId + '>', inline: true },
      { name: 'Product', value: String(s.productTitle || 'Unknown').slice(0, 100), inline: true },
      { name: 'Status', value: s.status, inline: true },
      { name: 'Roblox link', value: String(s.robloxUrl || 'Not provided').slice(0, 1024) }
    );
}
export async function sendDecision(client, submission, actor, note) {
  const user = await client.users.fetch(submission.userId).catch(() => null);
  if (user) await user.send(`**Update on ${submission.title}: ${submission.status.toUpperCase()}**${note ? `\n\n${note}` : ''}\n\nUse `/mysubmissions` in the server to check your submission.`).catch(() => {});
  if (process.env.REVIEW_LOG_CHANNEL_ID) {
    const channel = await client.channels.fetch(process.env.REVIEW_LOG_CHANNEL_ID).catch(() => null);
    if (channel?.isTextBased()) await channel.send({ embeds: [new EmbedBuilder().setColor(submission.status === 'approved' ? 0x35c997 : submission.status === 'rejected' ? 0xff6877 : 0x9a7bff).setTitle(`${submission.status.toUpperCase()} · ${submission.title}`).setDescription(note || 'No message added').addFields({ name: 'Developer', value: `<@${submission.userId}>`, inline: true }, { name: 'Reviewer', value: `<@${actor}>`, inline: true })] }).catch(() => {});
  }
}
