const fs = require('fs');

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_KEY || '';

fs.writeFileSync(
  'config.js',
  `const SUPABASE_URL = '${url}';\nconst SUPABASE_KEY = '${key}';\n`
);

console.log('config.js generado OK');
