const fs = require('fs');
const path = require('path');
const d = '.github/workflows';
fs.readdirSync(d).filter(f => f.endsWith('.yml')).forEach(f => {
    const fullPath = path.join(d, f);
    let content = fs.readFileSync(fullPath, 'utf8');
    content = content.replace(/pip install scrapling playwright/g, 'pip install "scrapling[fetchers]==0.4.15" playwright');
    content = content.replace(/playwright install chromium/g, 'playwright install --with-deps chromium');
    fs.writeFileSync(fullPath, content);
});
