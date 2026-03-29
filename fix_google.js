const fs = require('fs');
const path = require('path');

const scriptPath = path.join(__dirname, 'public', 'Script.js');
const content = fs.readFileSync(scriptPath, 'utf8');

// Check what markers exist
const markers = [
  'initTokenClient',
  'accounts.id.prompt()',
  'OAuth2 Access Token flow',
  'Google Identity Services',
  'google.accounts.oauth2'
];
markers.forEach(m => {
  const idx = content.indexOf(m);
  console.log(`"${m}" -> ${idx === -1 ? 'NOT FOUND' : 'found at ' + idx}`);
});

// Show lines around the function
const lines = content.split('\n');
console.log('\nLine count:', lines.Count || lines.length);
for (let i = 1073; i <= 1090; i++) {
  console.log(`L${i+1}: ${(lines[i]||'').substring(0,80)}`);
}
