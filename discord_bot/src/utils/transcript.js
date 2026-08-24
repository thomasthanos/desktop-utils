const { buildSessionDir, saveAttachmentToDisk } = require('./attachments');

const LOTTIE_STICKER = 3;

function formatAuthorTag(user) {
  if (!user) return 'Άγνωστος#0000';
  if (user.tag) return user.tag;
  if (user.discriminator && user.discriminator !== '0') return `${user.username}#${user.discriminator}`;
  return user.username || 'Unknown';
}

function extensionOf(url, fallback) {
  const clean = String(url || '').split('?')[0].split('#')[0];
  const last = clean.slice(clean.lastIndexOf('/') + 1);
  const dot = last.lastIndexOf('.');
  if (dot === -1) return fallback;

  const ext = last.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{2,5}$/.test(ext) ? ext : fallback;
}

async function keepRemoteCopy(url, name, sessionDir, messageId) {
  if (!url) return null;

  const stored = await saveAttachmentToDisk(
    { url, proxyURL: url, name: `${name}.${extensionOf(url, 'png')}` },
    sessionDir,
    messageId
  );
  return stored.storedOnDisk ? stored.filePath : null;
}

async function serializeMessage(message, guildId) {
  const sessionDir = buildSessionDir(guildId, null, message.author?.id || 'unknown');

  const attachments = [];
  for (const attachment of Array.from(message.attachments.values())) {
    const stored = await saveAttachmentToDisk(attachment, sessionDir, message.id);
    attachments.push({
      name: attachment.name || 'file',
      url: attachment.url || '',
      proxyUrl: attachment.proxyURL || '',
      contentType: attachment.contentType || null,
      size: attachment.size || 0,
      filePath: stored.filePath,
      storedOnDisk: stored.storedOnDisk,
      storeError: stored.storeError
    });
  }

  const embeds = [];
  for (const [index, embed] of message.embeds.entries()) {
    const imageUrl = embed.image?.url || null;
    const thumbnailUrl = embed.thumbnail?.url || null;
    const videoUrl = embed.video?.url || null;

    embeds.push({
      title: embed.title || null,
      description: embed.description || null,
      url: embed.url || null,
      author: embed.author?.name || null,
      thumbnail: thumbnailUrl,
      image: imageUrl,
      video: videoUrl,
      imageFilePath: await keepRemoteCopy(imageUrl, `embed${index}-image`, sessionDir, message.id),
      thumbnailFilePath: await keepRemoteCopy(thumbnailUrl, `embed${index}-thumb`, sessionDir, message.id),
      videoFilePath: await keepRemoteCopy(videoUrl, `embed${index}-video`, sessionDir, message.id),
      fields: (embed.fields || []).map((field) => ({
        name: field.name,
        value: field.value,
        inline: Boolean(field.inline)
      }))
    });
  }

  const stickers = [];
  for (const sticker of message.stickers?.values?.() || []) {
    if (sticker.format === LOTTIE_STICKER) continue;

    stickers.push({
      name: sticker.name || String(sticker.id),
      url: sticker.url || '',
      filePath: await keepRemoteCopy(sticker.url, `sticker-${sticker.id}`, sessionDir, message.id)
    });
  }

  const avatarUrl = message.author?.displayAvatarURL?.({ forceStatic: false, size: 128 }) || null;
  const avatarName = `avatar-${message.author?.id || 'unknown'}`;

  return {
    id: message.id,
    author: formatAuthorTag(message.author),
    authorId: message.author?.id || null,
    authorAvatarUrl: avatarUrl,
    authorAvatarFilePath: await keepRemoteCopy(avatarUrl, avatarName, sessionDir, message.id),
    content: message.content || '',
    createdAt: message.createdAt?.toISOString?.() || null,
    attachments,
    stickers,
    embeds
  };
}

module.exports = { formatAuthorTag, serializeMessage, extensionOf };
