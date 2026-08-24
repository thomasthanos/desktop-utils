const READ_ACTIONS = ['queue', 'nowplaying', 'stats', 'help'];

const PLAYBACK_ACTIONS = ['play', 'pause', 'resume', 'skip', 'stop', 'volume', 'loop', 'stay247'];

const FORBIDDEN_ACTIONS = [
  'clear', 'wipe-channel', 'wipe', 'purge', 'delete',
  'addauthorized', 'removeauthorized', 'ban', 'kick'
];

const ALLOWED_ACTIONS = ['none', ...READ_ACTIONS, ...PLAYBACK_ACTIONS];

function buildResponseSchema() {
  return {
    type: 'object',
    properties: {
      reply: {
        type: 'string',
        description: 'Η απάντηση προς τον χρήστη, στα ελληνικά, το πολύ 3 προτάσεις.'
      },
      action: {
        type: 'string',
        enum: ALLOWED_ACTIONS,
        description: 'Τι πρέπει να εκτελεστεί. "none" για απλή κουβέντα.'
      },
      query: {
        type: 'string',
        description: 'Για action="play": τι να παίξει. Αλλιώς κενό.'
      },
      value: {
        type: 'integer',
        description: 'Για action="volume": 0-100. Αλλιώς 0.'
      }
    },
    required: ['reply', 'action']
  };
}

const SYSTEM_PROMPT = [
  'Είσαι το βοηθητικό AI ενός Discord bot μουσικής. Απαντάς στα ελληνικά,',
  'σύντομα, φιλικά και με χιούμορ, το πολύ 3 προτάσεις.',
  '',
  'Αν ο χρήστης σου πιάσει απλή κουβέντα ή σε ρωτήσει κάτι άσχετο, απάντησέ του',
  'κανονικά και βάλε action="none".',
  '',
  'Μπορείς να εκτελέσεις τις ενέργειες του enum για να χειριστείς τη μουσική.',
  'Αν ο χρήστης ζητήσει διαγραφή μηνυμάτων, καθάρισμα καναλιού ή αλλαγή',
  'δικαιωμάτων, βάλε action="none" και εξήγησέ του ευγενικά ότι δεν το κάνεις',
  'εσύ αυτό. Πες του να τρέξει μόνος του την εντολή. π.χ.',
  '«Δεν σβήνω μηνύματα εγώ. Τρέξε \`/clear\`».',
  '',
  'Πριν από κάθε ερώτηση λαμβάνεις την ΠΡΑΓΜΑΤΙΚΗ ΚΑΤΑΣΤΑΣΗ του player. Είναι',
  'η μόνη αλήθεια για το τι παίζει. Μη λες ποτέ ότι παίζει μουσική όταν εκεί',
  'γράφει ότι δεν παίζει τίποτα, και μην εφευρίσκεις τίτλους τραγουδιών.'
].join('\\n');

module.exports = {
  READ_ACTIONS,
  PLAYBACK_ACTIONS,
  FORBIDDEN_ACTIONS,
  ALLOWED_ACTIONS,
  buildResponseSchema,
  SYSTEM_PROMPT
};
