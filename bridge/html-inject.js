// ==========================================
// bridge/html-inject.js
// Отдаёт index.html с автоматически вставленными скриптами моста,
// чтобы не редактировать 60+ КБ разметки вручную.
// ==========================================

const fs = require('fs');
const path = require('path');

const DEFAULT_TARGETS = ['/', '/index.html', '/index mini.html'];

const SNIPPET = [
    '<!-- Tuya <-> SmartThings bridge (вставлено автоматически) -->',
    '<script src="/socket.io/socket.io.js"></script>',
    '<script src="/js/bridge.js"></script>',
    '<script src="/js/bridge-panel.js"></script>'
].join('\n');

function alreadyHasSocketIo(html) {
    return /socket\.io\/socket\.io\.js/.test(html);
}

function buildSnippet(html) {
    if (!alreadyHasSocketIo(html)) return SNIPPET;
    return SNIPPET.split('\n')
        .filter((line) => !line.includes('/socket.io/socket.io.js'))
        .join('\n');
}

function injectClientScript(options = {}) {
    const rootDir = options.rootDir || process.cwd();
    const targets = options.targets || DEFAULT_TARGETS;

    return function bridgeHtmlInject(req, res, next) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();

        let reqPath = req.path || '/';
        try {
            reqPath = decodeURIComponent(reqPath);
        } catch (e) {
            return next();
        }

        if (targets.indexOf(reqPath) === -1) return next();

        const fileName = reqPath === '/' ? 'index.html' : reqPath.replace(/^\//, '');
        const absolute = path.join(rootDir, fileName);

        // Защита от выхода за пределы каталога проекта
        if (!absolute.startsWith(path.resolve(rootDir))) return next();

        fs.readFile(absolute, 'utf8', (err, html) => {
            if (err || !html) return next();

            let output = html;
            if (!html.includes('/js/bridge.js')) {
                const snippet = buildSnippet(html);
                output = html.includes('</body>')
                    ? html.replace('</body>', snippet + '\n</body>')
                    : html + '\n' + snippet;
            }

            res.set('Content-Type', 'text/html; charset=utf-8');
            res.set('Cache-Control', 'no-cache');
            res.send(output);
        });
    };
}

module.exports = { injectClientScript, DEFAULT_TARGETS };
