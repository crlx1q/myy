#!/usr/bin/env node
/*
 * tools/convert-scenes.js
 *
 * Offline converter: original Living Worlds scene files (images/<name>.js,
 * ~1.1-1.7 MB of boxed JS numbers each) -> compact binary .lwb files.
 *
 * Why: the original format is a JavaScript Array of 307200 boxed numbers per
 * scene plus 2-38 palettes of 256 [r,g,b] sub-arrays. Parsing one scene costs
 * several MB of heap on a device that only has 278 MB of RAM in total, and the
 * original index.html loaded ALL 22 of them at once (~30 MB). That is the main
 * reason the page dies after a few minutes on a Galaxy Ace.
 *
 * The .lwb container stores exactly the same numbers, byte for byte, but as
 * raw bytes, so decoding is a memcpy instead of 307200 JSON number parses.
 *
 * .lwb layout (all integers little-endian):
 *
 *   0   4    magic  "LWB1"
 *   4   4    uint32 headerLength
 *   8   N    header JSON, ASCII
 *   8+N      palette block: nPalettes * 768 bytes (R,G,B per color, 256 colors)
 *   ...      pixel block:   width * height bytes (palette indices)
 *
 * header JSON:
 *   { v, name, title, month, weather, w, h,
 *     cycles: [[rate, reverse, low, high], ...],   // from scene.base.cycles
 *     pals:   ["paletteKey", ...],                 // block order
 *     tl:     [[secondsFromMidnight, palIndex], ...] }  // sorted ascending
 *
 * The per-scene `remap` overrides from the original scenes.js are baked into
 * the palette block at conversion time (the original applied them at runtime
 * in CanvasCycle.initPalettes, to the timeline palettes only - we do the same).
 *
 * Usage:
 *   node tools/convert-scenes.js [pathToOriginalLivingWorlds] [outDir]
 *
 * Defaults: ./vendor/living-worlds-original  ->  ./lw/scenes
 */

'use strict'

var fs = require('fs')
var path = require('path')
var vm = require('vm')

/* Catalogue: index order is identical to the original scenes.js. */
var CATALOG = [
	{ i: 0, file: 'V26janclr', title: 'January - Winter Forest - Clear', month: 1, weather: 'clear' },
	{ i: 1, file: 'V26SNOWjansnow', title: 'January - Winter Forest - Snow', month: 1, weather: 'snow' },
	{ i: 2, file: 'V19febclr', title: 'February - Mountain Stream - Clear', month: 2, weather: 'clear' },
	{ i: 3, file: 'V19febcldy', title: 'February - Mountain Stream - Cloudy', month: 2, weather: 'cloudy' },
	{ i: 4, file: 'VW3BASIC', title: 'March - Monolith Plains - Clear', month: 3, weather: 'clear' },
	{ i: 5, file: 'V30aprclr', title: 'April - Deep Forest - Clear', month: 4, weather: 'clear' },
	{ i: 6, file: 'V30RAINaprrain', title: 'April - Deep Forest - Rain', month: 4, weather: 'rain' },
	{ i: 7, file: 'V08mayclr', title: 'May - Jungle Waterfall - Clear', month: 5, weather: 'clear' },
	{ i: 8, file: 'V08maycldy', title: 'May - Jungle Waterfall - Cloudy', month: 5, weather: 'cloudy' },
	{ i: 9, file: 'V08RAINmayrain', title: 'May - Jungle Waterfall - Rain', month: 5, weather: 'rain' },
	{ i: 10, file: 'V20JOEjunday', title: 'June - Crystal Caves - Clear', month: 6, weather: 'clear' },
	{ i: 11, file: 'V25julyclr', title: 'July - Desert - Clear', month: 7, weather: 'clear' },
	{ i: 12, file: 'V25julycldy', title: 'July - Desert - Cloudy', month: 7, weather: 'cloudy' },
	{ i: 13, file: 'CORAL', title: 'August - Aquarius - Clear', month: 8, weather: 'clear', remap: { 0: [0, 0, 0] } },
	{ i: 14, file: 'V29septclr', title: 'September - Seascape - Clear', month: 9, weather: 'clear', remap: { 252: [11, 11, 11] } },
	{ i: 15, file: 'V29septcldy', title: 'September - Seascape - Cloudy', month: 9, weather: 'cloudy', remap: { 252: [11, 11, 11] } },
	{ i: 16, file: 'V05AMoctbegclr', title: 'Early October - Haunted Ruins - Clear', month: 10, weather: 'clear', half: 'early', remap: { 254: [0, 0, 0], 0: [11, 11, 11] } },
	{ i: 17, file: 'V05octendclr', title: 'Late October - Haunted Ruins - Clear', month: 10, weather: 'clear', half: 'late', remap: { 254: [0, 0, 0], 0: [11, 11, 11] } },
	{ i: 18, file: 'V05RAINoctrain', title: 'Late October - Haunted Ruins - Rain', month: 10, weather: 'rain', remap: { 254: [0, 0, 0], 0: [11, 11, 11] } },
	{ i: 19, file: 'V16novclr', title: 'November - Mirror Pond - Clear', month: 11, weather: 'clear' },
	{ i: 20, file: 'V16RAINnovrain', title: 'November - Mirror Pond - Rain', month: 11, weather: 'rain' },
	{ i: 21, file: 'V12BASICdecclr', title: 'December - Winter Manor - Clear', month: 12, weather: 'clear' },
]

function loadSceneObject(jsPath) {
	var code = fs.readFileSync(jsPath, 'utf8')
	var sandbox = {}
	vm.createContext(sandbox)
	vm.runInContext(code, sandbox, { filename: jsPath, timeout: 60000 })

	// The original files declare one global whose name is usually <file> + "x",
	// except VW3BASIC which has no suffix. Detect structurally instead of by name.
	var keys = Object.keys(sandbox)
	for (var k = 0; k < keys.length; k++) {
		var v = sandbox[keys[k]]
		if (v && v.base && v.base.pixels && v.palettes && v.timeline) return { varName: keys[k], scene: v }
	}
	throw new Error('No scene object found in ' + jsPath + ' (globals: ' + keys.join(', ') + ')')
}

function buildLwb(meta, scene) {
	var base = scene.base
	var w = base.width
	var h = base.height
	if (!w || !h) throw new Error(meta.file + ': missing width/height')
	if (base.pixels.length !== w * h) {
		throw new Error(meta.file + ': pixel count ' + base.pixels.length + ' != ' + w * h)
	}

	// --- palettes, in a stable order -------------------------------------
	var palKeys = Object.keys(scene.palettes)
	var nPal = palKeys.length
	var palBlock = Buffer.alloc(nPal * 768)

	for (var p = 0; p < nPal; p++) {
		var pal = scene.palettes[palKeys[p]]
		var colors = pal.colors
		if (colors.length !== 256) throw new Error(meta.file + '/' + palKeys[p] + ': ' + colors.length + ' colors')

		// Bake the runtime remap (original: CanvasCycle.initPalettes).
		if (meta.remap) {
			for (var ri in meta.remap) {
				if (!Object.prototype.hasOwnProperty.call(meta.remap, ri)) continue
				colors[ri][0] = meta.remap[ri][0]
				colors[ri][1] = meta.remap[ri][1]
				colors[ri][2] = meta.remap[ri][2]
			}
		}

		var off = p * 768
		for (var c = 0; c < 256; c++) {
			palBlock[off + c * 3 + 0] = colors[c][0] & 0xff
			palBlock[off + c * 3 + 1] = colors[c][1] & 0xff
			palBlock[off + c * 3 + 2] = colors[c][2] & 0xff
		}
	}

	// --- timeline, sorted ascending --------------------------------------
	var tl = []
	for (var offset in scene.timeline) {
		if (!Object.prototype.hasOwnProperty.call(scene.timeline, offset)) continue
		var key = scene.timeline[offset]
		var idx = palKeys.indexOf(key)
		if (idx < 0) throw new Error(meta.file + ': timeline points at unknown palette "' + key + '"')
		tl.push([parseInt(offset, 10), idx])
	}
	tl.sort(function (a, b) {
		return a[0] - b[0]
	})
	if (!tl.length) throw new Error(meta.file + ': empty timeline')

	// --- cycles (scene.base.cycles is what Bitmap/Palette actually uses) --
	var cycles = []
	for (var ci = 0; ci < base.cycles.length; ci++) {
		var cy = base.cycles[ci]
		cycles.push([cy.rate | 0, cy.reverse | 0, cy.low | 0, cy.high | 0])
	}

	var header = {
		v: 1,
		name: meta.file,
		title: meta.title,
		month: meta.month,
		weather: meta.weather,
		w: w,
		h: h,
		cycles: cycles,
		pals: palKeys,
		tl: tl,
	}
	var headerBuf = Buffer.from(JSON.stringify(header), 'utf8')

	var pixelBuf = Buffer.alloc(w * h)
	var px = base.pixels
	for (var i = 0; i < px.length; i++) pixelBuf[i] = px[i] & 0xff

	var out = Buffer.alloc(8 + headerBuf.length + palBlock.length + pixelBuf.length)
	out.write('LWB1', 0, 4, 'ascii')
	out.writeUInt32LE(headerBuf.length, 4)
	headerBuf.copy(out, 8)
	palBlock.copy(out, 8 + headerBuf.length)
	pixelBuf.copy(out, 8 + headerBuf.length + palBlock.length)

	return { buf: out, nPal: nPal, tl: tl.length, cycles: cycles }
}

function main() {
	var src = process.argv[2] || path.join(process.cwd(), 'vendor', 'living-worlds-original')
	var outDir = process.argv[3] || path.join(process.cwd(), 'lw', 'scenes')

	var imagesDir = path.join(src, 'images')
	if (!fs.existsSync(imagesDir)) {
		console.error('ERROR: ' + imagesDir + ' not found.')
		console.error('')
		console.error('Point the converter at your unpacked Living Worlds folder, e.g.')
		console.error('  node tools/convert-scenes.js ../living-worlds-master lw/scenes')
		process.exit(1)
	}
	fs.mkdirSync(outDir, { recursive: true })

	var manifest = []
	var totalIn = 0
	var totalOut = 0

	for (var n = 0; n < CATALOG.length; n++) {
		var meta = CATALOG[n]
		var jsPath = path.join(imagesDir, meta.file + '.js')
		if (!fs.existsSync(jsPath)) {
			console.error('MISSING  ' + meta.file + '.js')
			process.exitCode = 1
			continue
		}
		var inSize = fs.statSync(jsPath).size
		var loaded = loadSceneObject(jsPath)
		var built = buildLwb(meta, loaded.scene)
		var outPath = path.join(outDir, meta.file + '.lwb')
		fs.writeFileSync(outPath, built.buf)

		totalIn += inSize
		totalOut += built.buf.length

		manifest.push({
			i: meta.i,
			file: meta.file,
			title: meta.title,
			month: meta.month,
			weather: meta.weather,
			half: meta.half || null,
			bytes: built.buf.length,
			palettes: built.nPal,
			timeline: built.tl,
		})

		console.log(
			pad(meta.i, 2) +
				'  ' +
				padRight(meta.file, 17) +
				padRight(meta.weather, 7) +
				pad((inSize / 1048576).toFixed(2), 6) +
				' MB -> ' +
				pad((built.buf.length / 1024).toFixed(0), 4) +
				' KB   ' +
				pad(built.nPal, 2) +
				' palettes, ' +
				pad(built.tl, 2) +
				' timeline pts'
		)
	}

	fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, '\t'))

	console.log('')
	console.log(
		'Total: ' +
			(totalIn / 1048576).toFixed(1) +
			' MB of .js  ->  ' +
			(totalOut / 1048576).toFixed(1) +
			' MB of .lwb  (' +
			ManifestPct(totalOut, totalIn) +
			' of original)'
	)
	console.log('Written to ' + outDir)
}

function ManifestPct(a, b) {
	return ((a / b) * 100).toFixed(0) + '%'
}
function pad(s, n) {
	s = '' + s
	while (s.length < n) s = ' ' + s
	return s
}
function padRight(s, n) {
	s = '' + s
	while (s.length < n) s = s + ' '
	return s
}

module.exports = { CATALOG: CATALOG, loadSceneObject: loadSceneObject, buildLwb: buildLwb }

if (require.main === module) main()
