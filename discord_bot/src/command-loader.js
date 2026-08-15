const fs = require('fs');
const path = require('path');
const log = require('./utils/logger')('commands');

/**
 * Φορτώνει αναδρομικά κάθε εντολή από το src/commands.
 *
 * Μια εντολή είναι έγκυρη όταν εκθέτει `data` (SlashCommandBuilder) και
 * `execute`. Ένα σπασμένο αρχείο καταγράφεται και παραλείπεται αντί να ρίξει
 * όλο το bot — μια εντολή με τυπογραφικό δεν πρέπει να αφήνει το bot offline.
 *
 * @returns {{commands: Map, slashCommands: object[]}}
 */
function loadCommands(client, dir = path.join(__dirname, 'commands')) {
  const files = [];

  (function walk(current) {
    if (!fs.existsSync(current)) {
      log.warn(`Directory not found: ${current}`);
      return;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  }(dir));

  const slashCommands = [];
  const dmCommands = [];

  for (const filePath of files) {
    try {
      const command = require(filePath);

      // Σκόπιμα ανενεργή (π.χ. η /ask χωρίς κλειδί AI). Δεν είναι σφάλμα, και
      // δεν πρέπει να καταγράφεται σαν σφάλμα — αλλιώς κάθε εκκίνηση χωρίς
      // κλειδί βγάζει μια προειδοποίηση που δεν σημαίνει τίποτα.
      if (command?.disabled) {
        log.info(`${path.basename(filePath)} is disabled: ${command.disabled}`);
        continue;
      }

      if (command?.data && typeof command.execute === 'function') {
        client.commands.set(command.data.name, command);
        const json = command.data.toJSON();
        slashCommands.push(json);
        if (command.dmCapable) dmCommands.push(toDmCommand(json));
        continue;
      }
      log.warn(`Skipped invalid command module: ${filePath}`);
    } catch (error) {
      log.error(`Failed to load ${filePath}:`, error);
    }
  }

  log.info(`Loaded ${slashCommands.length} commands (${dmCommands.length} usable in DMs).`);
  return { commands: client.commands, slashCommands, dmCommands };
}

/**
 * Η ίδια εντολή, καταχωρημένη ΚΑΘΟΛΙΚΑ και περιορισμένη σε DM.
 *
 * Οι εντολές που δένονται σε guild δεν εμφανίζονται ποτέ σε DM — είναι δύο
 * ξεχωριστές διαδρομές καταχώρησης στο Discord, όχι μία ρύθμιση. Χωρίς όμως
 * τον περιορισμό `contexts: [BotDM]` η καθολική εκδοχή θα εμφανιζόταν και μέσα
 * στους servers, δίπλα στην guild εκδοχή: η ίδια εντολή δύο φορές στη λίστα.
 *
 *   contexts          1 = BotDM. ΜΟΝΟ αυτό — το PrivateChannel (2) θέλει
 *                     user-install, που είναι άλλη ροή εγκατάστασης.
 *   integration_types 0 = GuildInstall, δηλαδή η υπάρχουσα εγκατάσταση.
 */
function toDmCommand(json) {
  return { ...json, contexts: [1], integration_types: [0] };
}

module.exports = { loadCommands, toDmCommand };
