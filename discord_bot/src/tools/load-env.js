const fs = require('fs');
const path = require('path');

function loadEnv() {
  const sources = [];
  let unreadable = null;

  const local = path.join(__dirname, '..', '..', '.env');
  if (fs.existsSync(local)) {
    require('dotenv').config({ path: local });
    sources.push(local);
  }

  const serviceFile = process.env.ENV_FILE || '/etc/discord-bot.env';
  try {
    fs.accessSync(serviceFile, fs.constants.R_OK);
    require('dotenv').config({ path: serviceFile });
    sources.push(serviceFile);
  } catch (error) {
    if (error.code === 'EACCES') unreadable = serviceFile;
  }

  return { sources, unreadable };
}

module.exports = { loadEnv };
