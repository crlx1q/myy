#!/usr/bin/env node
/*
 * tools/install-mini.js
 *
 * Idempotent installer: builds "index minia.html" - a copy of
 * "index mini.html" with the Living Worlds background wired into it. The
 * original plain screen is left exactly as it was, so both versions stay
 * available side by side.
 *
 * It adds whole lines only, and nothing else:
 *   1. a <style> block before </head>              (canvas layering + panel)
 *   2. <canvas id="lw-canvas"> as the first child of #page-clock
 *   3. one line at the top of updateClock()        -> LW.tick(new Date())
 *   4. one line at the top of showPage(n)          -> LW.setActive(n === 0)
 *   5. one line at the top of updateWeather()      -> LW.setWeather(weatherData)
 *   6. <script src="lw/living-worlds.js"> + LW.init() before </body>
 *
 * Every inserted line carries LW:BEGIN / LW:END markers and reuses the line
 * ending of the anchor line, so the file keeps its original CRLF. Running
 * the installer twice changes nothing, and --uninstall restores the file
 * byte for byte.
 *
 * Usage:
 *   node tools/install-mini.js                          # mini -> minia
 *   node tools/install-mini.js --sync                   # re-copy mini first
 *   node tools/install-mini.js "index minia.html" --check
 *   node tools/install-mini.js "index minia.html" --uninstall
 *   node tools/install-mini.js "index mini.html" --in-place
 */

'use strict'

var fs = require('fs')

var HB = '<!-- LW:BEGIN -->'
var HE = '<!-- LW:END -->'
var JB = '/* LW:BEGIN */'
var JE = '/* LW:END */'

/* ---------------------------------------------------------------- *
 * Content to insert (as arrays of lines, without line endings)
 * ---------------------------------------------------------------- */

var STYLE_LINES = [
	HB,
	'    <style>',
	'        /* Living Worlds animated background.',
	'           Lives inside #page-clock, strictly behind every .dash-box,',
	'           never scrolls, never overflows, no pointer events. */',
	'        #lw-canvas {',
	'            position: absolute;',
	'            left: 0;',
	'            top: 0;',
	'            z-index: 0;',
	'            display: none;',
	'            pointer-events: none;',
	'            image-rendering: -moz-crisp-edges;',
	'            image-rendering: crisp-edges;',
	'            image-rendering: pixelated;',
	'        }',
	'        /* Keep the SmartHome UI on top and readable over moving pixels. */',
	'        #page-clock .dash-box {',
	'            z-index: 1;',
	'            text-shadow: 0 1px 3px #000, 0 0 8px #000;',
	'        }',
	'        /* The online status chip doubles as the fullscreen button:',
	'           one tap goes fullscreen, the next one comes back.',
	'           Bigger padding only so it is comfortable to hit with a finger. */',
	'        #status-server {',
	'            padding: 7px 10px;',
	'            border: 1px solid #444;',
	'            cursor: pointer;',
	'            -webkit-tap-highlight-color: rgba(255, 255, 255, 0.3);',
	'        }',
	'        /* Quality panel. Only exists in the DOM while it is open. */',
	'        #lw-panel {',
	'            position: absolute;',
	'            left: 4px;',
	'            right: 4px;',
	'            bottom: 4px;',
	'            z-index: 99;',
	'            background: #000;',
	'            border: 1px solid #333;',
	'            border-radius: 6px;',
	'            padding: 6px;',
	'            font-size: 11px;',
	'            color: #ddd;',
	'        }',
	'        #lw-panel .lw-h { font-weight: bold; margin-bottom: 2px; }',
	'        #lw-panel .lw-i { color: #888; margin-bottom: 4px; }',
	'        #lw-panel .lw-r { margin: 2px 0; white-space: nowrap; }',
	'        #lw-panel .lw-l { display: inline-block; width: 74px; color: #999; }',
	'        #lw-panel .lw-b {',
	'            background: #222;',
	'            color: #ccc;',
	'            border: 1px solid #444;',
	'            border-radius: 3px;',
	'            padding: 3px 6px;',
	'            margin-right: 3px;',
	'            font-size: 11px;',
	'        }',
	'        #lw-panel .lw-on { background: #0a4; color: #fff; border-color: #0a4; }',
	'        #lw-panel .lw-close { background: #422; border-color: #644; }',
	'    </style>',
	HE,
]

var CANVAS_LINES = ['        ' + HB + '<canvas id="lw-canvas" width="320" height="240"></canvas>' + HE]

var BOOT_LINES = [
	HB,
	'<!-- lw/config.js is a plain settings file: profile = ace, fps = 20, ... -->',
	'<script src="lw/config.js"></script>',
	'<script src="lw/living-worlds.js"></script>',
	'<script>if (window.LW) { LW.init(); }</script>',
	HE,
]

/* anchor -> lines inserted directly after the anchor line */
var AFTER = [
	{
		label: 'canvas',
		anchor: '<div class="page active" id="page-clock">',
		lines: CANVAS_LINES,
	},
	{
		label: 'updateClock hook',
		anchor: 'function updateClock() {',
		lines: ['    ' + JB + ' if (window.LW) { LW.tick(new Date()); } ' + JE],
	},
	{
		label: 'showPage hook',
		anchor: 'function showPage(n) {',
		lines: ['    ' + JB + ' if (window.LW) { LW.setActive(n === 0); } ' + JE],
	},
	{
		label: 'updateWeather hook',
		anchor: 'function updateWeather() {',
		lines: ['    ' + JB + ' if (window.LW) { LW.setWeather(weatherData); } ' + JE],
	},
]

/* anchor -> lines inserted directly before the anchor line */
var BEFORE = [
	{ label: 'style block', anchor: '</head>', lines: STYLE_LINES },
	{ label: 'boot script', anchor: '</body>', lines: BOOT_LINES },
]

/* ---------------------------------------------------------------- *
 * Line helpers that preserve the original line endings
 * ---------------------------------------------------------------- */

function splitKeepEol(src) {
	var out = src.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g)
	return out || []
}

function eolOf(line) {
	if (!line) return '\n'
	if (/\r\n$/.test(line)) return '\r\n'
	if (/\n$/.test(line)) return '\n'
	if (/\r$/.test(line)) return '\r'
	return ''
}

function fail(msg) {
	console.error('ERROR: ' + msg)
	process.exit(1)
}

function findLine(lines, anchor, label, fromEnd) {
	var hits = []
	for (var i = 0; i < lines.length; i++) {
		if (lines[i].indexOf(anchor) >= 0) hits.push(i)
	}
	if (!hits.length) fail('anchor not found (' + label + '): ' + anchor)
	if (hits.length > 1) {
		console.warn(
			'  note: "' + anchor + '" occurs ' + hits.length + ' times, using the ' + (fromEnd ? 'last' : 'first')
		)
	}
	return fromEnd ? hits[hits.length - 1] : hits[0]
}

/* Remove every line between LW:BEGIN and LW:END inclusive. Because all
 * inserted content is whole lines, this is exact. */
function stripLines(lines) {
	var out = []
	var removed = 0
	var inside = false
	for (var i = 0; i < lines.length; i++) {
		var L = lines[i]
		var hasB = L.indexOf(HB) >= 0 || L.indexOf(JB) >= 0
		var hasE = L.indexOf(HE) >= 0 || L.indexOf(JE) >= 0
		if (inside) {
			removed++
			if (hasE) inside = false
			continue
		}
		if (hasB) {
			removed++
			if (!hasE) inside = true
			continue
		}
		out.push(L)
	}
	if (inside) fail('unbalanced LW markers in the file, refusing to continue')
	return { lines: out, removed: removed }
}

function insertLines(lines, at, payload, eol) {
	var built = []
	for (var i = 0; i < payload.length; i++) built.push(payload[i] + eol)
	var args = [at, 0].concat(built)
	Array.prototype.splice.apply(lines, args)
	return payload.length
}

/* ---------------------------------------------------------------- *
 * Main
 * ---------------------------------------------------------------- */

function main() {
	var args = process.argv.slice(2)
	var flags = {}
	var file = null
	for (var a = 0; a < args.length; a++) {
		if (args[a].indexOf('--') === 0) flags[args[a].substring(2)] = true
		else if (file === null) file = args[a]
	}
	var SRC_DEFAULT = 'index mini.html'
	var OUT_DEFAULT = 'index minia.html'
	var createdCopy = false

	if (!file) file = flags['in-place'] ? SRC_DEFAULT : OUT_DEFAULT

	/* Default mode never touches the original screen: "index minia.html" is a
	 * copy of "index mini.html" plus the Living Worlds lines. --sync refreshes
	 * that copy from the original before patching it again. */
	if (!flags['in-place'] && file === OUT_DEFAULT) {
		if (!fs.existsSync(SRC_DEFAULT)) fail(SRC_DEFAULT + ' not found')
		if (!fs.existsSync(file) || flags.sync) {
			fs.writeFileSync(file, fs.readFileSync(SRC_DEFAULT))
			createdCopy = true
			console.log((flags.sync ? 're-copied ' : 'created ') + file + '  <- ' + SRC_DEFAULT)
		}
	}

	if (!fs.existsSync(file)) fail(file + ' not found')
	var src = fs.readFileSync(file, 'utf8')
	var lines = splitKeepEol(src)
	var wasInstalled = src.indexOf(HB) >= 0 || src.indexOf(JB) >= 0

	if (flags.check) {
		console.log(file + ': ' + (wasInstalled ? 'Living Worlds IS installed' : 'clean, not installed'))
		console.log('  lines: ' + lines.length)
		return
	}

	var bak = file + '.bak'
	if (!createdCopy && !fs.existsSync(bak) && !wasInstalled) {
		fs.writeFileSync(bak, src)
		console.log('backup -> ' + bak)
	}

	// Always rewind to a clean file first. Makes install idempotent and
	// uninstall exact.
	var stripped = stripLines(lines)
	lines = stripped.lines

	if (flags.uninstall) {
		fs.writeFileSync(file, lines.join(''))
		console.log(
			stripped.removed ? 'Removed ' + stripped.removed + ' Living Worlds line(s) from ' + file : 'Nothing to remove.'
		)
		return
	}

	var added = 0
	var i, at, eol

	// "before" anchors: </head> first, </body> last (use the last </body>)
	for (i = 0; i < BEFORE.length; i++) {
		at = findLine(lines, BEFORE[i].anchor, BEFORE[i].label, BEFORE[i].anchor === '</body>')
		eol = eolOf(lines[at]) || '\n'
		added += insertLines(lines, at, BEFORE[i].lines, eol)
	}

	// "after" anchors
	for (i = 0; i < AFTER.length; i++) {
		at = findLine(lines, AFTER[i].anchor, AFTER[i].label, false)
		eol = eolOf(lines[at]) || '\n'
		added += insertLines(lines, at + 1, AFTER[i].lines, eol)
	}

	var out = lines.join('')
	fs.writeFileSync(file, out)

	console.log((wasInstalled ? 'Re-installed' : 'Installed') + ' Living Worlds into ' + file)
	console.log('  + <style> block                          before </head>')
	console.log('  + <canvas id="lw-canvas">                 inside #page-clock')
	console.log('  + LW.tick(new Date())                    in updateClock()')
	console.log('  + LW.setActive(n === 0)                  in showPage()')
	console.log('  + LW.setWeather(weatherData)             in updateWeather()')
	console.log('  + <script src="lw/config.js">             before </body>')
	console.log('  + <script src="lw/living-worlds.js">      before </body>')
	console.log('  ' + added + ' lines added, nothing else touched.')
}

main()
