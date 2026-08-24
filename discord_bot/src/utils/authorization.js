const { MessageFlags, PermissionsBitField } = require('discord.js');

function getBotOwnerIds() {
  const raw = [process.env.BOT_OWNER_ID, process.env.BOT_OWNER_IDS]
    .filter(Boolean)
    .join(',');

  return [...new Set(
    String(raw)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  )];
}

function isBotOwner(userId) {
  if (!userId) return false;
  return getBotOwnerIds().includes(String(userId));
}

function isGuildOwner(interaction) {
  return Boolean(interaction?.guild && interaction?.user && interaction.guild.ownerId === interaction.user.id);
}

function canManageAuthorization(interaction) {
  const userId = interaction?.user?.id || null;
  return isBotOwner(userId) || isGuildOwner(interaction);
}

// Οι κατηγορίες που κλειδώνονται. Κρατιέται εδώ και όχι σε λίστα ονομάτων, ώστε
// μια νέα εντολή σε αυτές να γίνεται περιοριστέα χωρίς να το θυμηθεί κανείς.
const RESTRICTABLE_CATEGORIES = ['Moderation', 'Admin', 'Invites'];

// Η εντολή που μοιράζει τα δικαιώματα δεν κλειδώνεται ποτέ — αλλιώς κλειδώνεσαι έξω.
const NEVER_RESTRICTABLE = ['addauthorized'];

// Το /247 είναι στη Μουσική για το /help, αλλά στην ουσία είναι ρύθμιση του
// server: αλλάζει αν το bot φεύγει ποτέ από το voice. Ρυθμίζεται ξεχωριστά.
const ALWAYS_RESTRICTABLE = ['247'];

function isRestrictableCommand(command) {
  const name = command?.data?.name;
  if (!name || NEVER_RESTRICTABLE.includes(name)) return false;
  if (ALWAYS_RESTRICTABLE.includes(name)) return true;
  return RESTRICTABLE_CATEGORIES.includes(command.category || 'General');
}

function restrictableCommands(client) {
  const found = [];

  client?.commands?.forEach?.((command) => {
    if (!isRestrictableCommand(command)) return;
    found.push({
      name: command.data.name,
      description: command.data.description,
      category: command.category || 'General',
      // Ποιος την τρέχει όταν δεν υπάρχει λίστα. Κάποιες εντολές δεν είναι
      // ποτέ ανοιχτές σε όλους, ακόμα κι αν κανείς δεν έχει οριστεί ρητά.
      defaultAudience: command.defaultAudience || null,
      defaultPermissions: command.data.default_member_permissions || null
    });
  });

  // Κατηγορία εκτός λίστας (π.χ. το /247 στη Μουσική) πάει στο τέλος.
  const rank = (category) => {
    const index = RESTRICTABLE_CATEGORIES.indexOf(category);
    return index === -1 ? RESTRICTABLE_CATEGORIES.length : index;
  };

  return found.sort((a, b) => (
    a.category === b.category
      ? a.name.localeCompare(b.name)
      : rank(a.category) - rank(b.category)
  ));
}

function isGuildAdmin(interaction) {
  const permissions = interaction?.member?.permissions;
  if (typeof permissions?.has !== 'function') return false;
  return permissions.has(PermissionsBitField.Flags.Administrator);
}

function roleIdsOf(interaction) {
  const cache = interaction?.member?.roles?.cache;
  if (typeof cache?.keys !== 'function') return [];
  return [...cache.keys()];
}

function isCommandAuthorized(interaction, database, commandName) {
  if (!interaction?.inGuild?.()) return false;
  if (!commandName) return false;

  if (canManageAuthorization(interaction)) return true;

  return database.isAuthorizedPrincipal(
    interaction.guildId,
    commandName,
    interaction.user.id,
    roleIdsOf(interaction)
  );
}

async function replyUnauthorized(interaction, commandLabel = 'this command') {
  const payload = {
    content: `Δεν έχεις δικαίωμα για το ${commandLabel}. Ωραία προσπάθεια.`,
    flags: MessageFlags.Ephemeral
  };

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload);
    return;
  }

  await interaction.reply(payload);
}

module.exports = {
  getBotOwnerIds,
  isBotOwner,
  isGuildOwner,
  canManageAuthorization,
  isCommandAuthorized,
  replyUnauthorized,
  roleIdsOf,
  isGuildAdmin,
  isRestrictableCommand,
  restrictableCommands,
  RESTRICTABLE_CATEGORIES,
  NEVER_RESTRICTABLE,
  ALWAYS_RESTRICTABLE
};
