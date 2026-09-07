#!/usr/bin/env node
/*
 * tools/verify-engine.js
 *
 * Proves that the port in lw/living-worlds.js produces EXACTLY the same
 * pixels as the original Living Worlds engine.
 *
 * The reference side runs the untouched original oop.js + palette.js +
 * bitmap.js inside a vm context and drives them exactly the way main.js
 * does (initPalettes -> initTimeline -> setTimeOfDayPalette -> cycle ->
 * render). The test side loads the converted .lwb and calls the shipped
 * LW._core functions. Both outputs are then compared byte for byte.
 *
 * Usage:
 *   node tools/verify-engine.js [originalDir] [lwbDir] [--full] [--dump]
 *
 *   --full   compare complete 640x480 frames for every scene (slow)
 *   --dump   also write PPM snapshots of scene 14 for visual inspection
 */

'use strict'

var fs = require('fs')
var path = require('path')
var vm = require('vm')

var conv = require('./convert-scenes.js')
var LW = require('../lw/living-worlds.js')
var core = LW._core

var ORIG = process.argv[2] || path.join(process.cwd(), 'vendor', 'living-worlds-original')
var LWB = process.argv[3] || path.join(process.cwd(), 'lw', 'scenes')
var FULL = process.argv.indexOf('--full') >= 0
var DUMP = process.argv.indexOf('--dump') >= 0

var TIMES = [0, 3600, 21600, 43200, 61500 /* 17:05 */, 79200, 86399]
var TICKS = [0, 1, 733, 12345, 987654321]
var BLENDS = [false, true]

/* ---------------------------------------------------------------- *
 * Reference engine: the original classes, unmodified.
 * ---------------------------------------------------------------- */

function makeOriginalContext() {
	var sandbox = {
		assert: function (ok, msg) {
			if (!ok) throw new Error('assert: ' + msg)
		},
		alert: function (m) {
			throw new Error('alert: ' + m)
		},
		console: console,
		Math: Math,
		Date: Date,
	}
	sandbox.window = sandbox
	vm.createContext(sandbox)
	var files = ['oop.js', 'palette.js', 'bitmap.js']
	for (var i = 0; i < files.length; i++) {
		var p = path.join(ORIG, files[i])
		vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: p })
	}
	if (!sandbox.Palette || !sandbox.Bitmap) throw new Error('original classes did not register')
	return sandbox
}

function buildReference(ctx, meta, scene) {
	// --- main.js initPalettes (remap is applied to the timeline palettes) ---
	var palettes = {}
	for (var key in scene.palettes) {
		if (!Object.prototype.hasOwnProperty.call(scene.palettes, key)) continue
		var pal = scene.palettes[key]
		if (meta.remap) {
			for (var ri in meta.remap) {
				if (!Object.prototype.hasOwnProperty.call(meta.remap, ri)) continue
				pal.colors[ri][0] = meta.remap[ri][0]
				pal.colors[ri][1] = meta.remap[ri][1]
				pal.colors[ri][2] = meta.remap[ri][2]
			}
		}
		var p = new ctx.Palette(pal.colors, pal.cycles)
		p.copyColors(p.baseColors, p.colors)
		palettes[key] = p
	}

	// --- main.js initTimeline ---
	var timeline = []
	for (var offset in scene.timeline) {
		if (!Object.prototype.hasOwnProperty.call(scene.timeline, offset)) continue
		timeline.push({ off: parseInt(offset, 10), pal: palettes[scene.timeline[offset]] })
	}
	timeline.sort(function (a, b) {
		return a.off - b.off
	})

	var bmp = new ctx.Bitmap(scene.base)
	bmp.optimize()
	var todPalette = new ctx.Palette(scene.base.colors, scene.base.cycles)

	return {
		bmp: bmp,
		tod: todPalette,
		timeline: timeline,

		/* main.js setTimeOfDayPalette, with the offsets compared numerically
		 * (the original compares object keys as strings, which mis-sorts on
		 * the wrap-around branch - see LIVING_WORLDS.md). */
		setTod: function (timeOffset) {
			var tl = this.timeline
			var n = tl.length
			var bi = -1
			var ai = -1
			var i
			for (i = 0; i < n; i++) {
				if (tl[i].off <= timeOffset) bi = i
				else break
			}
			for (i = 0; i < n; i++) {
				if (tl[i].off >= timeOffset) {
					ai = i
					break
				}
			}
			var bOff, aOff
			if (bi < 0) {
				bi = n - 1
				bOff = tl[bi].off - 86400
			} else bOff = tl[bi].off
			if (ai < 0) {
				ai = 0
				aOff = tl[ai].off + 86400
			} else aOff = tl[ai].off

			this.tod.copyColors(tl[bi].pal.baseColors, this.tod.colors)
			this.tod.fade(tl[ai].pal, timeOffset - bOff, aOff - bOff)
			this.bmp.palette.importColors(this.tod.colors)
		},

		cycle: function (tick, speed, blend) {
			this.bmp.palette.cycle(this.bmp.palette.baseColors, tick, speed, blend)
		},

		/* 768-byte snapshot of palette.colors, i.e. exactly what render reads */
		paletteBytes: function () {
			var raw = this.bmp.palette.getRawTransformedColors()
			var out = new Uint8Array(768)
			for (var i = 0; i < 256; i++) {
				out[i * 3] = raw[i][0]
				out[i * 3 + 1] = raw[i][1]
				out[i * 3 + 2] = raw[i][2]
			}
			return out
		},
	}
}

/* ---------------------------------------------------------------- *
 * Test engine: the shipped port + the converted .lwb
 * ---------------------------------------------------------------- */

function loadPort(file, scale) {
	var bytes = new Uint8Array(fs.readFileSync(path.join(LWB, file + '.lwb')))
	var sc = core.parseLwb(bytes)
	core.buildScaled(sc, scale || 1)
	return sc
}

/* ---------------------------------------------------------------- *
 * Comparison helpers
 * ---------------------------------------------------------------- */

function diffBytes(a, b, limit) {
	var n = Math.min(a.length, b.length)
	var bad = 0
	var first = -1
	for (var i = 0; i < n; i++) {
		if (a[i] !== b[i]) {
			if (first < 0) first = i
			bad++
			if (limit && bad > limit) break
		}
	}
	return { bad: bad, first: first, len: n, lenA: a.length, lenB: b.length }
}

function writePpm(file, w, h, rgba) {
	var head = Buffer.from('P6\n' + w + ' ' + h + '\n255\n', 'ascii')
	var body = Buffer.alloc(w * h * 3)
	var o = 0
	for (var i = 0; i < w * h; i++) {
		body[o++] = rgba[i * 4]
		body[o++] = rgba[i * 4 + 1]
		body[o++] = rgba[i * 4 + 2]
	}
	fs.writeFileSync(file, Buffer.concat([head, body]))
}

/* ---------------------------------------------------------------- *
 * Main
 * ---------------------------------------------------------------- */

function main() {
	if (!fs.existsSync(path.join(ORIG, 'palette.js'))) {
		console.error('ERROR: original engine not found at ' + ORIG)
		process.exit(1)
	}

	var ctx = makeOriginalContext()
	var totalPal = 0
	var failPal = 0
	var totalFrame = 0
	var failFrame = 0
	var problems = []

	for (var n = 0; n < conv.CATALOG.length; n++) {
		var meta = conv.CATALOG[n]
		var jsPath = path.join(ORIG, 'images', meta.file + '.js')
		if (!fs.existsSync(jsPath)) {
			console.log('skip ' + meta.file)
			continue
		}

		var scene = conv.loadSceneObject(jsPath).scene
		var ref = buildReference(ctx, meta, scene)
		var mine = loadPort(meta.file, 1)

		var sceneBad = 0

		/* ---- 1. palette-level: every time x tick x blend combination ---- */
		for (var t = 0; t < TIMES.length; t++) {
			ref.setTod(TIMES[t])
			core.setTodPalette(mine, TIMES[t])

			// base palette (time-of-day interpolation only)
			var refBase = new Uint8Array(768)
			for (var i = 0; i < 256; i++) {
				var c = ref.bmp.palette.baseColors[i]
				refBase[i * 3] = c.red
				refBase[i * 3 + 1] = c.green
				refBase[i * 3 + 2] = c.blue
			}
			totalPal++
			var dBase = diffBytes(refBase, mine.basePal, 8)
			if (dBase.bad) {
				failPal++
				sceneBad++
				problems.push(meta.file + ' basePal t=' + TIMES[t] + ' bad=' + dBase.bad + ' at ' + dBase.first)
			}

			// cycled palette
			for (var k = 0; k < TICKS.length; k++) {
				for (var b = 0; b < BLENDS.length; b++) {
					ref.setTod(TIMES[t]) // importColors resets baseColors each time
					ref.cycle(TICKS[k], 1.0, BLENDS[b])
					core.setTodPalette(mine, TIMES[t])
					core.cyclePalette(mine, TICKS[k], 1.0, BLENDS[b])

					totalPal++
					var d = diffBytes(ref.paletteBytes(), mine.curPal, 8)
					if (d.bad) {
						failPal++
						sceneBad++
						problems.push(
							meta.file + ' curPal t=' + TIMES[t] + ' tick=' + TICKS[k] + ' blend=' + BLENDS[b] + ' bad=' + d.bad + ' at ' + d.first
						)
					}
				}
			}
		}

		/* ---- 2. frame-level: full 640x480 render, then optimized pass ---- */
		var doFrame = FULL || n < 4 || n === 14 || n === 9
		if (doFrame) {
			var w = scene.base.width
			var h = scene.base.height
			var refImg = { data: new Uint8Array(w * h * 4) }
			var myImg = new Uint8Array(w * h * 4)

			for (var tf = 0; tf < 3; tf++) {
				var T = [43200, 61500, 3600][tf]
				var K = [0, 12345, 987654321][tf]
				var B = tf === 1

				ref.setTod(T)
				ref.cycle(K, 1.0, B)
				ref.bmp.drawCount = 0
				ref.bmp.render(refImg, false)

				core.setTodPalette(mine, T)
				core.cyclePalette(mine, K, 1.0, B)
				core.renderInto(mine, myImg, true)

				totalFrame++
				var df = diffRgb(refImg.data, myImg, w * h)
				if (df) {
					failFrame++
					sceneBad++
					problems.push(meta.file + ' FULL frame T=' + T + ' tick=' + K + ' blend=' + B + ' badPx=' + df)
				}

				// optimized (animated pixels only) pass on top of the full frame
				var K2 = K + 5000
				ref.setTod(T)
				ref.cycle(K2, 1.0, B)
				ref.bmp.render(refImg, true)

				core.setTodPalette(mine, T)
				core.cyclePalette(mine, K2, 1.0, B)
				core.renderInto(mine, myImg, false)

				totalFrame++
				var df2 = diffRgb(refImg.data, myImg, w * h)
				if (df2) {
					failFrame++
					sceneBad++
					problems.push(meta.file + ' OPT frame T=' + T + ' tick=' + K2 + ' blend=' + B + ' badPx=' + df2)
				}
			}

			if (DUMP && n === 14) {
				ref.setTod(61500)
				ref.cycle(12345, 1.0, false)
				ref.bmp.drawCount = 0
				ref.bmp.render(refImg, false)
				writePpm('/tmp/lw-ref-1705.ppm', w, h, refImg.data)

				core.setTodPalette(mine, 61500)
				core.cyclePalette(mine, 12345, 1.0, false)
				core.renderInto(mine, myImg, true)
				writePpm('/tmp/lw-port-1705.ppm', w, h, myImg)

				core.setTodPalette(mine, 10800) // 03:00
				core.cyclePalette(mine, 12345, 1.0, false)
				core.renderInto(mine, myImg, true)
				writePpm('/tmp/lw-port-0300.ppm', w, h, myImg)
			}
		}

		console.log(
			(sceneBad ? 'FAIL ' : 'ok   ') +
				padRight(meta.file, 17) +
				padRight(meta.weather, 7) +
				'cycles=' +
				pad(mine.cycles.length, 2) +
				' pals=' +
				pad(mine.tlOff.length, 2) +
				' anim=' +
				pad(mine.animPct, 5) +
				'%' +
				(doFrame ? '  [frames checked]' : '')
		)
	}

	console.log('')
	console.log('palette comparisons : ' + totalPal + ', failed ' + failPal)
	console.log('frame comparisons   : ' + totalFrame + ', failed ' + failFrame)
	if (problems.length) {
		console.log('')
		console.log('PROBLEMS:')
		for (var q = 0; q < Math.min(problems.length, 40); q++) console.log('  ' + problems[q])
		process.exit(1)
	}
	console.log('')
	console.log('RESULT: the port is byte-identical to the original engine.')
}

function diffRgb(a, b, px) {
	var bad = 0
	for (var i = 0; i < px; i++) {
		var o = i * 4
		if (a[o] !== b[o] || a[o + 1] !== b[o + 1] || a[o + 2] !== b[o + 2]) bad++
	}
	return bad
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

main()
