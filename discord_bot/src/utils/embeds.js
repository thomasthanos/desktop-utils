const { EmbedBuilder } = require('discord.js');
const log = require('./logger')('embeds');

function buildNowPlayingEmbed({ title, url, author, duration, thumbnail, requestedBy }) {
  const embed = new EmbedBuilder()
    .setColor(0x1db954)
    .setTitle('🎵 Now Playing')
    .setDescription(`**[${title}](${url || '#'})**`)
    .addFields(
      { name: '🎤 Artist', value: author || 'Unknown', inline: true },
      { name: '⏱ Duration', value: duration || '--:--', inline: true },
      { name: '👤 Requested by', value: String(requestedBy || 'Unknown'), inline: true }
    )
    .setTimestamp();
  if (thumbnail) embed.setThumbnail(thumbnail);
  return embed;
}

/** Ο τίτλος ως σύνδεσμος, ή σκέτος όταν δεν υπάρχει url (π.χ. ζωντανή ροή). */
function linkedTitle(track) {
  return track?.url ? `**[${track.title}](${track.url})**` : `**${track?.title || 'Unknown'}**`;
}

/** Το όνομα του χρήστη — το discord-player δίνει άλλοτε User και άλλοτε string. */
function requesterName(requestedBy) {
  if (!requestedBy) return 'Unknown';
  return requestedBy.username || requestedBy.tag || String(requestedBy);
}

/**
 * Η απάντηση του /play και του !play.
 *
 * Σκόπιμα ΣΥΜΠΑΓΕΣ και όχι δεύτερο «Now Playing»: το playerStart ποστάρει ήδη
 * το μεγάλο embed με την πρόοδο. Δύο πανομοιότυπα embeds για το ίδιο τραγούδι
 * είναι θόρυβος — αυτό εδώ επιβεβαιώνει ότι η εντολή έπιασε, τίποτα άλλο.
 */
function buildPlayReplyEmbed({ track, requestedBy }) {
  const embed = new EmbedBuilder()
    .setColor(0x1db954)
    .setAuthor({ name: '▶ Ξεκίνησε' })
    .setDescription(linkedTitle(track))
    .addFields(
      { name: 'Καλλιτέχνης', value: track?.author || 'Unknown', inline: true },
      { name: 'Διάρκεια', value: track?.duration || 'LIVE', inline: true }
    )
    .setFooter({ text: `Ζητήθηκε από ${requesterName(requestedBy)}` });

  if (track?.thumbnail) embed.setThumbnail(track.thumbnail);
  return embed;
}

/**
 * Το κομμάτι δεν έπαιξε από την αρχική πηγή και βρέθηκε αλλού.
 *
 * Πορτοκαλί, όχι πράσινο: δεν είναι σφάλμα — παίζει μουσική — αλλά ούτε και το
 * κανονικό αποτέλεσμα. Ο τίτλος που ζήτησες και ο τίτλος που ακούς μπορεί να
 * διαφέρουν, και αυτό πρέπει να φαίνεται με μια ματιά.
 */
function buildSourceSwitchEmbed({ from, to, source = 'SoundCloud', requestedBy }) {
  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setAuthor({ name: `🔁 Αλλαγή πηγής → ${source}` })
    .setDescription(`${linkedTitle(to)}\n​`)
    .addFields(
      { name: 'Ζήτησες', value: from?.title || 'Unknown', inline: false },
      { name: 'Καλλιτέχνης', value: to?.author || 'Unknown', inline: true },
      { name: 'Διάρκεια', value: to?.duration || 'LIVE', inline: true }
    )
    .setFooter({ text: `Το YouTube αρνήθηκε τη ροή • ζητήθηκε από ${requesterName(requestedBy)}` });

  if (to?.thumbnail) embed.setThumbnail(to.thumbnail);
  return embed;
}

/**
 * Το bot κρατάει ΕΝΑ μήνυμα «τώρα παίζει» ανά guild και το επεξεργάζεται, αντί
 * να σπαμάρει καινούριο σε κάθε κομμάτι. Το αντικείμενο του μηνύματος
 * αποθηκεύεται στη μνήμη ώστε η ενημέρωση να μη στοιχίζει δύο κλήσεις στο API.
 */
function createEmbedManager(client) {
  async function updateMusicEmbed(guildId, channel, embed) {
    if (!channel || !guildId) return;
    const existing = client.musicEmbedByGuild.get(guildId);

    if (existing) {
      try {
        let msg = existing.msgObj;
        if (!msg) {
          const ch = existing.channelId === channel.id
            ? channel
            : (client.channels.cache.get(existing.channelId)
              || await client.channels.fetch(existing.channelId).catch(() => null));
          msg = ch ? await ch.messages.fetch(existing.messageId).catch(() => null) : null;
        }
        if (msg) {
          await msg.edit({ embeds: [embed] });
          existing.msgObj = msg;
          return;
        }
      } catch (error) {
        // Το μήνυμα διαγράφηκε ή χάθηκαν τα δικαιώματα. Αναμενόμενο· πέφτουμε
        // στη δημιουργία καινούριου παρακάτω.
        log.debug('Could not edit the now-playing embed:', error.message);
      }
      client.musicEmbedByGuild.delete(guildId);
    }

    try {
      const msg = await channel.send({ embeds: [embed] });
      client.musicEmbedByGuild.set(guildId, { channelId: channel.id, messageId: msg.id, msgObj: msg });
    } catch (error) {
      // Εδώ ο χρήστης όντως χάνει το μήνυμα «τώρα παίζει» — συνήθως λείπει το
      // δικαίωμα αποστολής στο κανάλι. Άξιζε να φαίνεται.
      log.warn(`Could not post the now-playing embed in #${channel.name}:`, error.message);
    }
  }

  async function deleteMusicEmbed(guildId) {
    const embedInfo = client.musicEmbedByGuild.get(guildId);
    if (!embedInfo) return;
    try {
      let msg = embedInfo.msgObj;
      if (!msg) {
        const ch = client.channels.cache.get(embedInfo.channelId)
          || await client.channels.fetch(embedInfo.channelId).catch(() => null);
        msg = ch ? await ch.messages.fetch(embedInfo.messageId).catch(() => null) : null;
      }
      if (msg) await msg.delete().catch(() => {});
    } catch (error) {
      // Ήδη διαγραμμένο ή απρόσιτο — προσπαθούσαμε ούτως ή άλλως να το σβήσουμε.
      log.debug('Could not delete the now-playing embed:', error.message);
    }
    client.musicEmbedByGuild.delete(guildId);
  }

  return { updateMusicEmbed, deleteMusicEmbed };
}

module.exports = {
  buildNowPlayingEmbed,
  buildPlayReplyEmbed,
  buildSourceSwitchEmbed,
  createEmbedManager
};
