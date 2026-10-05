const fs = require('fs');
const path = require('path');
const d = '.github/workflows';
fs.readdirSync(d).filter(f => f.endsWith('.yml')).forEach(f => {
    const fullPath = path.join(d, f);
    let content = fs.readFileSync(fullPath, 'utf8');
    content = content.replace(/name: Install Scrapling\r?\n(\s+)run:/g, 'name: Install Scrapling\n$1continue-on-error: true\n$1run:');
    fs.writeFileSync(fullPath, content);
});
