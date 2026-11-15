// Markdown → plain text for Civitai's description field (no Markdown support).
// Usage: node scripts/make-plain.mjs  → docs/civitai-description.txt
import fs from 'node:fs';

function plain(md) {
  return md
    .split('\n')
    .map((l) => {
      if (/^#{1,3} /.test(l)) return '\n' + l.replace(/^#+ /, '').replace(/^\d+\. /, (m) => m).toUpperCase();
      return l
        .replace(/^- /, '• ')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/→/g, '>');
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const article = fs.readFileSync('docs/civitai-article.md', 'utf8').split('\n---\n')[1];
const guide = fs.readFileSync('docs/quick-start.md', 'utf8').replace(/^# .*\n/, '');
const text = `${plain(article)}\n\n\n===== QUICK START =====\n\n${plain(guide)}\n`;
fs.writeFileSync('docs/civitai-description.txt', text.replace(/\n/g, '\r\n'));
console.log(text.length, 'chars → docs/civitai-description.txt');
