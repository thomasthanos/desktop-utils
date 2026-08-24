const fs = require('fs');
const path = require('path');
const log = require('./utils/logger')('commands');

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

function toDmCommand(json) {
  return { ...json, contexts: [1], integration_types: [0] };
}

module.exports = { loadCommands, toDmCommand };
