/**
 * Ελάχιστη ρύθμιση ESLint — μόνο κανόνες που πιάνουν ΣΦΑΛΜΑΤΑ, όχι στυλ.
 *
 * Ο λόγος που υπάρχει: το `node --check` επικυρώνει μόνο τη σύνταξη. Μια
 * αναφορά σε μεταβλητή που δεν δηλώθηκε ποτέ περνάει καθαρά και σκάει σε
 * runtime — και μας συνέβη ακριβώς αυτό στο /clear, στη γραμμή που τυπώνει το
 * μήνυμα επιτυχίας ΜΕΤΑ τη διαγραφή μηνυμάτων. Το `no-undef` το πιάνει.
 *
 *   npm run lint
 *
 * Δεν μπαίνει στο `npm test` επίτηδες: στον server εγκαθιστούμε με
 * `npm ci --omit=dev`, οπότε το eslint δεν υπάρχει εκεί και το test θα έσπαγε.
 */

const nodeGlobals = {
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  process: 'readonly',
  console: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  Buffer: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  queueMicrotask: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  AbortController: 'readonly',
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
  crypto: 'readonly',
  BigInt: 'readonly',
  structuredClone: 'readonly'
};

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  io: 'readonly',           // socket.io client, φορτώνεται με <script>
  Image: 'readonly',
  Audio: 'readonly',
  CustomEvent: 'readonly',
  MutationObserver: 'readonly',
  DOMParser: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly'
};

const errorRules = {
  'no-undef': 'error',
  // Οι μη χρησιμοποιούμενες μεταβλητές είναι συνήθως υπόλειμμα ημιτελούς
  // αλλαγής — ακριβώς το είδος που αφήνει μισοαλλαγμένο κώδικα.
  'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-unreachable': 'error',
  'no-const-assign': 'error',
  'no-self-assign': 'error',
  // Κλασική παγίδα: `catch {}` που καταπίνει τα πάντα είναι σκόπιμο εδώ σε
  // κάποια σημεία, αλλά μια ΚΕΝΗ συνθήκη ή μπλοκ αλλού είναι σχεδόν πάντα λάθος.
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-constant-condition': ['error', { checkLoops: false }]
};

export default [
  { ignores: ['node_modules/**', 'data/**', 'backups/**'] },
  {
    files: ['src/**/*.js'],
    ignores: ['src/dashboard/public/**'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: nodeGlobals },
    rules: errorRules
  },
  {
    // Ο κώδικας του dashboard τρέχει σε browser, όχι σε Node.
    files: ['src/dashboard/public/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: browserGlobals },
    rules: errorRules
  }
];
