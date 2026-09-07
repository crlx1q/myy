/*!
 * Living Worlds for SmartHome  v1.0.0
 * -----------------------------------------------------------------------
 * Palette-cycling animated pixel-art background for the SmartHome mini UI.
 *
 * Scene data and all animation math come from "Living Worlds" by Mark Ferrari
 * / Joseph Huckaby (Canvas Cycle, LGPL v3). The cycling, blend-shift and
 * time-of-day interpolation below are a faithful, allocation-free port of
 * palette.js / bitmap.js / main.js - same constants, same rounding, same
 * results. See LIVING_WORLDS.md for the line-by-line correspondence.
 *
 * Target device: Samsung Galaxy Ace GT-S5830, Firefox for Android.
 * Therefore: ES5 only, no audio, one canvas, one timer, zero per-frame
 * allocations, adjustable render scale.
 * -----------------------------------------------------------------------
 */
;(function (window, document) {
	'use strict'

	if (window.LW) return

	/* =====================================================================
	 * 0. Constants
	 * =================================================================== */

	var VERSION = '1.0.0'
	var PRECISION = 100 // Palette.PRECISION
	var CYCLE_SPEED = 280 // Palette.CYCLE_SPEED
	var DAY = 86400

	/* =====================================================================
	 * 1. Scene catalogue  (index order == original scenes.js)
	 * =================================================================== */

	var SCENES = [
		{ i: 0, file: 'V26janclr', title: 'January - Winter Forest - Clear', month: 1, w: 'clear' },
		{ i: 1, file: 'V26SNOWjansnow', title: 'January - Winter Forest - Snow', month: 1, w: 'snow' },
		{ i: 2, file: 'V19febclr', title: 'February - Mountain Stream - Clear', month: 2, w: 'clear' },
		{ i: 3, file: 'V19febcldy', title: 'February - Mountain Stream - Cloudy', month: 2, w: 'cloudy' },
		{ i: 4, file: 'VW3BASIC', title: 'March - Monolith Plains - Clear', month: 3, w: 'clear' },
		{ i: 5, file: 'V30aprclr', title: 'April - Deep Forest - Clear', month: 4, w: 'clear' },
		{ i: 6, file: 'V30RAINaprrain', title: 'April - Deep Forest - Rain', month: 4, w: 'rain' },
		{ i: 7, file: 'V08mayclr', title: 'May - Jungle Waterfall - Clear', month: 5, w: 'clear' },
		{ i: 8, file: 'V08maycldy', title: 'May - Jungle Waterfall - Cloudy', month: 5, w: 'cloudy' },
		{ i: 9, file: 'V08RAINmayrain', title: 'May - Jungle Waterfall - Rain', month: 5, w: 'rain' },
		{ i: 10, file: 'V20JOEjunday', title: 'June - Crystal Caves - Clear', month: 6, w: 'clear' },
		{ i: 11, file: 'V25julyclr', title: 'July - Desert - Clear', month: 7, w: 'clear' },
		{ i: 12, file: 'V25julycldy', title: 'July - Desert - Cloudy', month: 7, w: 'cloudy' },
		{ i: 13, file: 'CORAL', title: 'August - Aquarius - Clear', month: 8, w: 'clear' },
		{ i: 14, file: 'V29septclr', title: 'September - Seascape - Clear', month: 9, w: 'clear' },
		{ i: 15, file: 'V29septcldy', title: 'September - Seascape - Cloudy', month: 9, w: 'cloudy' },
		{ i: 16, file: 'V05AMoctbegclr', title: 'Early October - Haunted Ruins - Clear', month: 10, w: 'clear', half: 'early' },
		{ i: 17, file: 'V05octendclr', title: 'Late October - Haunted Ruins - Clear', month: 10, w: 'clear', half: 'late' },
		{ i: 18, file: 'V05RAINoctrain', title: 'Late October - Haunted Ruins - Rain', month: 10, w: 'rain' },
		{ i: 19, file: 'V16novclr', title: 'November - Mirror Pond - Clear', month: 11, w: 'clear' },
		{ i: 20, file: 'V16RAINnovrain', title: 'November - Mirror Pond - Rain', month: 11, w: 'rain' },
		{ i: 21, file: 'V12BASICdecclr', title: 'December - Winter Manor - Clear', month: 12, w: 'clear' },
	]

	/* Weather degradation chains. Confirmed with the user:
	 *   snow -> cloudy -> clear,  rain -> cloudy -> clear
	 * A scene is NEVER invented: we only ever pick an index that exists above. */
	var CHAIN = {
		clear: ['clear'],
		cloudy: ['cloudy', 'clear'],
		rain: ['rain', 'cloudy', 'clear'],
		snow: ['snow', 'cloudy', 'clear'],
	}

	/* =====================================================================
	 * 2. Weather mapping layer  (SmartHome/OpenWeatherMap -> Living Worlds)
	 *
	 * server.js:927 stores  main: data.weather[0].main.toLowerCase()
	 * so these are the real values, not the invented "cloudy" string.
	 * `description` is Russian (lang=ru) and is only a last-resort hint.
	 * =================================================================== */

	var MAIN_MAP = {
		clear: 'clear',
		clouds: 'cloudy',
		rain: 'rain',
		drizzle: 'rain',
		thunderstorm: 'rain',
		squall: 'rain',
		snow: 'snow',
		// "Atmosphere" group - visually overcast, so cloudy (degrades to clear).
		mist: 'cloudy',
		fog: 'cloudy',
		haze: 'cloudy',
		smoke: 'cloudy',
		dust: 'cloudy',
		sand: 'cloudy',
		ash: 'cloudy',
		tornado: 'cloudy',
	}

	/* OWM icon prefix -> mode. 01 clear, 02/03/04 clouds, 09/10 rain,
	 * 11 thunderstorm, 13 snow, 50 atmosphere. */
	var ICON_MAP = {
		'01': 'clear',
		'02': 'cloudy',
		'03': 'cloudy',
		'04': 'cloudy',
		'09': 'rain',
		'10': 'rain',
		'11': 'rain',
		'13': 'snow',
		'50': 'cloudy',
	}

	function mapWeather(wd) {
		if (!wd) return 'clear'
		var m = wd.main ? ('' + wd.main).toLowerCase() : ''
		if (MAIN_MAP[m]) return MAIN_MAP[m]
		var ic = wd.icon ? ('' + wd.icon).substring(0, 2) : ''
		if (ICON_MAP[ic]) return ICON_MAP[ic]
		var d = wd.description ? ('' + wd.description).toLowerCase() : ''
		if (d.indexOf('снег') >= 0 || d.indexOf('метел') >= 0 || d.indexOf('изморось') >= 0) return 'snow'
		if (d.indexOf('дожд') >= 0 || d.indexOf('ливн') >= 0 || d.indexOf('гроз') >= 0 || d.indexOf('морос') >= 0) return 'rain'
		if (d.indexOf('облач') >= 0 || d.indexOf('пасмур') >= 0 || d.indexOf('туман') >= 0 || d.indexOf('дымк') >= 0) return 'cloudy'
		return 'clear'
	}

	function pickScene(month, day, mode) {
		var chain = CHAIN[mode] || CHAIN.clear
		for (var c = 0; c < chain.length; c++) {
			var want = chain[c]
			for (var i = 0; i < SCENES.length; i++) {
				var s = SCENES[i]
				if (s.month !== month || s.w !== want) continue
				if (s.half) {
					var isEarly = day < Q.octSplitDay
					if ((s.half === 'early') !== isEarly) continue
				}
				return i
			}
		}
		return 0
	}

	/* =====================================================================
	 * 3. Quality levers
	 * =================================================================== */

	var PRESETS = {
		off: { enabled: false },
		/* still: nothing moves between light steps. Cheapest possible mode that
		 * still tracks sunrise/sunset. No cycling, no per-frame blit. */
		still: { enabled: true, fps: 15, scale: 3, animate: false, dirty: true, blendShift: false, todStep: 30, sceneCheckMin: 10, speed: 1.0 },
		/* nano and ace carry numbers measured on a real Galaxy Ace GT-S5830
		 * in Firefox 31, each held for several minutes:
		 *   nano  ~29 fps /  6 ms   (buffer 160x120, coarser picture)
		 *   ace   ~20 fps / 10 ms   (buffer 213x160, ~19 fps / 11 ms on the
		 *                            heaviest scene - May Rain) */
		nano: { enabled: true, fps: 25, scale: 4, animate: true, dirty: true, blendShift: false, todStep: 180, sceneCheckMin: 10, speed: 1.0 },
		ace: { enabled: true, fps: 20, scale: 3, animate: true, dirty: true, blendShift: false, todStep: 120, sceneCheckMin: 10, speed: 1.0 },
		low: { enabled: true, fps: 15, scale: 2, animate: true, dirty: true, blendShift: false, todStep: 60, sceneCheckMin: 5, speed: 1.0 },
		medium: { enabled: true, fps: 20, scale: 2, animate: true, dirty: true, blendShift: true, todStep: 30, sceneCheckMin: 5, speed: 1.0 },
		/* DANGER on old hardware: full 640x480 blit with no dirty rect. On a
		 * Galaxy Ace it ran for a few seconds and the phone rebooted, so the
		 * on-device panel does not offer it at all. Reachable only from
		 * lw/config.js (profile = high) or ?lw=high. */
		high: { enabled: true, fps: 30, scale: 1, animate: true, dirty: false, blendShift: true, todStep: 15, sceneCheckMin: 5, speed: 1.0 },
	}
	/* The watchdog walks this list left to right. It can reach 'still' but
	 * never 'off', so the background is never silently switched off. */
	var PRESET_ORDER = ['high', 'medium', 'low', 'ace', 'nano', 'still', 'off']
	/* What the on-device panel offers. 'high' is deliberately missing here. */
	var PANEL_ORDER = ['off', 'still', 'nano', 'ace', 'low', 'medium']

	var Q = {
		preset: 'ace', // measured best stability/looks trade-off on a real Ace
		enabled: true,
		fps: 20, // 20 is what the device actually sustains at scale 3
		scale: 3, // backing store = floor(640/scale) x floor(480/scale), 1..8
		animate: true, // false = light-only mode, no palette cycling at all
		dirty: true, // blit only the bounding box of the animated pixels
		blendShift: false, // smooth cycling; costs ~1 extra pass over each cycle
		todStep: 60, // seconds of simulated-clock granularity => full redraws/min
		speed: 1.0, // Palette speedAdjust
		sceneCheckMin: 5, // how often to re-evaluate month/weather (minutes)
		initDelay: 1500, // grace period so the first weather payload can arrive
		fit: 'cover', // cover | contain | fill
		focusX: 0.5,
		focusY: 0.5,
		octSplitDay: 16, // day-of-month boundary for early/late October
		watchdog: true,
		uiFps: 6, // fps cap while the quality panel is open, so it can scroll
		fsOnTap: false, // ?lwfs=1 : tapping the hot spot below toggles fullscreen
		fsTap: '#status-server', // fullscreen hot spot. 'screen' = anywhere on the page
		debug: false,
		base: 'lw/',
	}

	var STORE_KEY = 'lw.quality.v1'
	var TUNABLE = 'enabled fps scale animate dirty blendShift todStep speed sceneCheckMin initDelay fit focusX focusY octSplitDay watchdog uiFps fsOnTap fsTap debug preset'.split(' ')

	function applyPreset(name) {
		var p = PRESETS[name]
		if (!p) return false
		Q.preset = name
		for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) Q[k] = p[k]
		return true
	}

	/* -------------------------------------------------------------------
	 * lw/config.js support. window.LW_CONFIG is either a settings string
	 *   'profile = ace\nfps = 20'    (one "key = value" per line)
	 * or a plain object { profile: 'ace', fps: 20 }. The aliases below keep
	 * that file readable for a human; unknown keys are ignored instead of
	 * throwing, so a typo can never take the background down.
	 * ----------------------------------------------------------------- */
	var ALIAS = {
		profile: 'preset',
		preset: 'preset',
		fps: 'fps',
		pixels: 'scale',
		scale: 'scale',
		div: 'scale',
		divider: 'scale',
		light: 'todStep',
		todstep: 'todStep',
		blit: 'dirty',
		dirty: 'dirty',
		anim: 'animate',
		animate: 'animate',
		smooth: 'blendShift',
		blend: 'blendShift',
		blendshift: 'blendShift',
		crop: 'fit',
		fit: 'fit',
		speed: 'speed',
		fullscreenontap: 'fsOnTap',
		fsontap: 'fsOnTap',
		fstap: 'fsTap',
		fsbutton: 'fsTap',
		fullscreenbutton: 'fsTap',
		scenecheck: 'sceneCheckMin',
		scenecheckmin: 'sceneCheckMin',
		octsplitday: 'octSplitDay',
		initdelay: 'initDelay',
		focusx: 'focusX',
		focusy: 'focusY',
		uifps: 'uiFps',
		watchdog: 'watchdog',
		enabled: 'enabled',
		debug: 'debug',
		lock: 'lock'
	}
	var BOOLKEY = { enabled: 1, animate: 1, dirty: 1, blendShift: 1, watchdog: 1, fsOnTap: 1, debug: 1, lock: 1 }
	var CFG = null

	function parseConfig(src) {
		var out = {}
		var pairs = []
		var i, k, v, L, c, n
		if (typeof src === 'string') {
			var lines = src.split(/[\r\n;&]+/)
			for (i = 0; i < lines.length; i++) {
				L = lines[i]
				c = L.indexOf('#')
				if (c >= 0) L = L.substring(0, c)
				c = L.indexOf('//')
				if (c >= 0) L = L.substring(0, c)
				c = L.indexOf('=')
				if (c < 0) continue
				k = L.substring(0, c).replace(/^\s+|\s+$/g, '').toLowerCase()
				v = L.substring(c + 1).replace(/^\s+|\s+$/g, '')
				if (k && v !== '') pairs.push([k, v])
			}
		} else if (src && typeof src === 'object') {
			for (k in src) {
				if (Object.prototype.hasOwnProperty.call(src, k)) pairs.push([String(k).toLowerCase(), src[k]])
			}
		}
		for (i = 0; i < pairs.length; i++) {
			k = ALIAS[pairs[i][0]]
			if (!k) continue
			v = pairs[i][1]
			if (BOOLKEY[k]) {
				if (typeof v === 'boolean') out[k] = v
				else {
					v = String(v).toLowerCase()
					out[k] = !(v === '0' || v === 'off' || v === 'false' || v === 'no' || v === '\u043d\u0435\u0442')
				}
			} else if (k === 'fsTap') {
				/* A CSS selector, so keep the original letter case. */
				out[k] = String(v)
			} else if (k === 'preset' || k === 'fit') {
				out[k] = String(v).toLowerCase()
			} else {
				n = parseFloat(v)
				if (!isNaN(n)) out[k] = n
			}
		}
		return out
	}

	function applyConfig(o) {
		if (!o) return
		if (o.preset && PRESETS[o.preset]) applyPreset(o.preset)
		for (var i = 0; i < TUNABLE.length; i++) {
			var k = TUNABLE[i]
			if (k !== 'preset' && typeof o[k] !== 'undefined') Q[k] = o[k]
		}
		Q.fps = Math.max(1, Math.min(60, Math.round(Q.fps) || 15))
		Q.scale = Math.max(1, Math.min(8, Math.round(Q.scale) || 2))
	}

	function loadPrefs() {
		/* 1. lw/config.js - the file a human edits */
		try {
			if (CFG === null) CFG = parseConfig(window.LW_CONFIG)
			applyConfig(CFG)
		} catch (e0) {
			CFG = {}
		}
		/* 2. whatever was tuned with the on-device panel wins over the file,
		 *    unless the file says  lock = 1 */
		try {
			var raw = CFG && CFG.lock ? null : window.localStorage && window.localStorage.getItem(STORE_KEY)
			if (raw) {
				var o = JSON.parse(raw)
				if (o && o.preset && PRESETS[o.preset]) applyPreset(o.preset)
				for (var i = 0; i < TUNABLE.length; i++) {
					var k = TUNABLE[i]
					if (o && typeof o[k] !== 'undefined') Q[k] = o[k]
				}
			}
		} catch (e) {}
		// URL overrides:  ?lw=off   ?lw=ace   ?lwfps=12&lwscale=3&lwblend=0
		try {
			var s = window.location.search || ''
			var mp = /[?&]lw=([a-z]+)/i.exec(s)
			if (mp && PRESETS[mp[1].toLowerCase()]) applyPreset(mp[1].toLowerCase())
			var num = function (re, key, min, max) {
				var m = re.exec(s)
				if (m) {
					var v = parseFloat(m[1])
					if (!isNaN(v)) Q[key] = Math.max(min, Math.min(max, v))
				}
			}
			num(/[?&]lwfps=(\d+)/i, 'fps', 1, 60)
			num(/[?&]lwscale=(\d+)/i, 'scale', 1, 8)
			num(/[?&]lwtod=(\d+)/i, 'todStep', 1, 900)
			num(/[?&]lwspeed=([\d.]+)/i, 'speed', 0.1, 4)
			var mb = /[?&]lwblend=([01])/i.exec(s)
			if (mb) Q.blendShift = mb[1] === '1'
			var mf = /[?&]lwfit=(cover|contain|fill)/i.exec(s)
			if (mf) Q.fit = mf[1].toLowerCase()
			var md = /[?&]lwdirty=([01])/i.exec(s)
			if (md) Q.dirty = md[1] === '1'
			var ma = /[?&]lwanim=([01])/i.exec(s)
			if (ma) Q.animate = ma[1] === '1'
			if (/[?&]lwdebug=1/i.test(s)) Q.debug = true
			if (/[?&]lwfs=1/i.test(s)) Q.fsOnTap = true
		} catch (e2) {}
	}

	function savePrefs() {
		try {
			var o = {}
			for (var i = 0; i < TUNABLE.length; i++) o[TUNABLE[i]] = Q[TUNABLE[i]]
			if (window.localStorage) window.localStorage.setItem(STORE_KEY, JSON.stringify(o))
		} catch (e) {}
	}

	/* =====================================================================
	 * 4. Environment
	 * =================================================================== */

	var hasTyped = typeof Uint8Array !== 'undefined' && typeof Uint32Array !== 'undefined'
	var isNode = typeof window.document === 'undefined' || !window.document.createElement

	function nowMs() {
		return new Date().getTime()
	}
	function log() {
		if (Q.debug && window.console && window.console.log) window.console.log.apply(window.console, arguments)
	}

	/* =====================================================================
	 * 5. Core maths - faithful port of palette.js
	 * =================================================================== */

	/* Palette.DFLOAT_MOD - variable precision floating point modulus */
	function dmod(a, b) {
		return (Math.floor(a * PRECISION) % Math.floor(b * PRECISION)) / PRECISION
	}

	/* Palette.fadeColor, one channel:
	 *   floor( src + ((dst - src) * frame) / max ) */
	function fade1(s, d, frame, max) {
		var v = Math.floor(s + ((d - s) * frame) / max)
		return v < 0 ? 0 : v > 255 ? 255 : v
	}

	/* Scratch buffer for one cycle range (max 256 colors * 3 channels). */
	var TMP = hasTyped ? new Uint8Array(768) : null

	/*
	 * shiftColors / blendShiftColors / reverseColors, fused into a single
	 * O(cycleSize) pass instead of the original O(amount * cycleSize) rotate
	 * plus 256 `new Color()` objects per cycle per frame.
	 *
	 * Original sequence for one cycle:
	 *   if (reverse == 2) reverseColors(c)
	 *   blendShift ? blendShiftColors(c, cycle, amount) : shiftColors(c, cycle, amount)
	 *   if (reverse == 2) reverseColors(c)
	 *
	 * shiftColors rotates the range right by floor(amount):
	 *   out[low + ((k + n) % size)] = in[low + k]
	 * blendShiftColors then blends every entry with its predecessor by
	 *   frame = floor((amount - floor(amount)) * PRECISION)
	 * reading pre-blend values only (the original loop walks downward, so
	 * colors[j] is still untouched when colors[j+1] is written).
	 */
	function applyCycle(buf, low, high, amount, blend) {
		var size = high - low + 1
		if (size <= 1) return
		var rev = false
		if (amount < 0) amount = 0
		var intAmt = Math.floor(amount)
		var frame = blend ? Math.floor((amount - intAmt) * PRECISION) : 0
		var i, o, m, a, b, ia, ib, pa, pb

		for (i = 0; i < size; i++) {
			o = (low + i) * 3
			TMP[i * 3] = buf[o]
			TMP[i * 3 + 1] = buf[o + 1]
			TMP[i * 3 + 2] = buf[o + 2]
		}
		rev = applyCycle.rev
		for (m = 0; m < size; m++) {
			a = (m - intAmt) % size
			if (a < 0) a += size
			ia = rev ? size - 1 - a : a
			pa = ia * 3
			o = (low + (rev ? size - 1 - m : m)) * 3
			if (frame) {
				b = a - 1
				if (b < 0) b += size
				ib = rev ? size - 1 - b : b
				pb = ib * 3
				buf[o] = fade1(TMP[pa], TMP[pb], frame, PRECISION)
				buf[o + 1] = fade1(TMP[pa + 1], TMP[pb + 1], frame, PRECISION)
				buf[o + 2] = fade1(TMP[pa + 2], TMP[pb + 2], frame, PRECISION)
			} else {
				buf[o] = TMP[pa]
				buf[o + 1] = TMP[pa + 1]
				buf[o + 2] = TMP[pa + 2]
			}
		}
	}
	applyCycle.rev = false

	/* Palette.cycle - base palette in, cycled palette out. No allocations. */
	function cyclePalette(sc, tickMs, speedAdjust, blend) {
		var base = sc.basePal
		var cur = sc.curPal
		var k
		for (k = 0; k < 768; k++) cur[k] = base[k]

		var cyc = sc.cycles
		var denom = Math.floor(CYCLE_SPEED / speedAdjust)
		if (!denom) denom = 1

		for (var ci = 0; ci < cyc.length; ci++) {
			var c = cyc[ci]
			if (!c.rate) continue
			var size = c.high - c.low + 1
			var rate = c.rate / denom
			var t = tickMs / (1000 / rate)
			var amount

			if (c.reverse < 3) {
				amount = dmod(t, size)
			} else if (c.reverse === 3) {
				amount = dmod(t, size * 2)
				if (amount >= size) amount = size * 2 - amount
			} else if (c.reverse < 6) {
				// The original throws ReferenceError here (bare DFLOAT_MOD);
				// implemented as intended.
				amount = dmod(t, size)
				amount = Math.sin((amount * 3.1415926 * 2) / size) + 1
				amount *= c.reverse === 4 ? size / 4 : size / 2
			} else {
				continue
			}

			applyCycle.rev = c.reverse === 2
			applyCycle(cur, c.low, c.high, amount, blend)
		}
	}

	/* main.js setTimeOfDayPalette - interpolate the two nearest timeline
	 * palettes, wrapping around midnight. Written with numeric comparisons
	 * (the original compared object keys as strings, which mis-sorts on the
	 * wrap-around branch). */
	function setTodPalette(sc, timeOffset) {
		var off = sc.tlOff
		var n = off.length
		var bi = -1
		var ai = -1
		var i

		for (i = 0; i < n; i++) {
			if (off[i] <= timeOffset) bi = i
			else break
		}
		for (i = 0; i < n; i++) {
			if (off[i] >= timeOffset) {
				ai = i
				break
			}
		}

		var bOff, aOff
		if (bi < 0) {
			bi = n - 1
			bOff = off[bi] - DAY // yesterday
		} else bOff = off[bi]
		if (ai < 0) {
			ai = 0
			aOff = off[ai] + DAY // tomorrow
		} else aOff = off[ai]

		var pb = sc.tlPal[bi] * 768
		var pa = sc.tlPal[ai] * 768
		var src = sc.palBytes
		var out = sc.basePal
		var max = aOff - bOff
		var frame = timeOffset - bOff
		var k

		if (!max) {
			for (k = 0; k < 768; k++) out[k] = src[pb + k]
			return
		}
		if (frame < 0) frame = 0
		if (frame > max) frame = max
		for (k = 0; k < 768; k++) {
			var s0 = src[pb + k]
			out[k] = fade1(s0, src[pa + k], frame, max)
		}
	}

	/* bitmap.js render - full pass or animated-pixels-only pass. */
	function renderInto(sc, data, full) {
		var pal = sc.curPal
		var spx = sc.spx
		var j, p, o

		if (!full && sc.optIdx && sc.optIdx.length) {
			var oi = sc.optIdx
			var len = oi.length
			for (var x = 0; x < len; x++) {
				j = oi[x]
				p = spx[j] * 3
				o = j << 2
				data[o] = pal[p]
				data[o + 1] = pal[p + 1]
				data[o + 2] = pal[p + 2]
			}
		} else {
			var n = spx.length
			o = 0
			for (j = 0; j < n; j++) {
				p = spx[j] * 3
				data[o] = pal[p]
				data[o + 1] = pal[p + 1]
				data[o + 2] = pal[p + 2]
				o += 4
			}
		}
	}

	/* =====================================================================
	 * 6. .lwb container parsing
	 * =================================================================== */

	function parseLwb(bytes) {
		if (bytes.length < 8) throw new Error('lwb too short')
		if (bytes[0] !== 76 || bytes[1] !== 87 || bytes[2] !== 66 || bytes[3] !== 49) throw new Error('bad magic')
		var hLen = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24)

		var chunk = []
		var step = 4096
		for (var s = 0; s < hLen; s += step) {
			var e = Math.min(hLen, s + step)
			var part = []
			for (var i = s; i < e; i++) part.push(bytes[8 + i])
			chunk.push(String.fromCharCode.apply(null, part))
		}
		var hdr = JSON.parse(decodeUtf8(chunk.join('')))

		var palOff = 8 + hLen
		var nPal = hdr.pals.length
		var pxOff = palOff + nPal * 768
		var pxLen = hdr.w * hdr.h
		if (bytes.length < pxOff + pxLen) throw new Error('lwb truncated')

		var cycles = []
		for (var c = 0; c < hdr.cycles.length; c++) {
			var a = hdr.cycles[c]
			if (!a[0]) continue // rate 0 == inactive, same as the original
			cycles.push({ rate: a[0], reverse: a[1], low: a[2], high: a[3] })
		}

		var tlOff = []
		var tlPal = []
		for (var t = 0; t < hdr.tl.length; t++) {
			tlOff.push(hdr.tl[t][0])
			tlPal.push(hdr.tl[t][1])
		}

		return {
			name: hdr.name,
			title: hdr.title,
			w: hdr.w,
			h: hdr.h,
			cycles: cycles,
			palBytes: bytes.subarray ? bytes.subarray(palOff, palOff + nPal * 768) : bytes.slice(palOff, palOff + nPal * 768),
			pixels: bytes.subarray ? bytes.subarray(pxOff, pxOff + pxLen) : bytes.slice(pxOff, pxOff + pxLen),
			tlOff: tlOff,
			tlPal: tlPal,
			basePal: new Uint8Array(768),
			curPal: new Uint8Array(768),
			spx: null,
			optIdx: null,
			scale: 0,
			sw: 0,
			sh: 0,
		}
	}

	/* Header is ASCII in practice, but titles could carry UTF-8. */
	function decodeUtf8(s) {
		try {
			return decodeURIComponent(escape(s))
		} catch (e) {
			return s
		}
	}

	/* Build the sub-sampled pixel buffer and the animated-pixel index list
	 * for the current render scale. Done once per scene per scale, never
	 * per frame. */
	function buildScaled(sc, scale) {
		var w = sc.w
		var h = sc.h
		var sw = Math.floor(w / scale)
		var sh = Math.floor(h / scale)
		var spx = new Uint8Array(sw * sh)
		var px = sc.pixels
		var k = 0
		var x, y, row

		for (y = 0; y < sh; y++) {
			row = y * scale * w
			for (x = 0; x < sw; x++) spx[k++] = px[row + x * scale]
		}

		// bitmap.js optimize(): mark colors that belong to an animated cycle
		var optColors = new Uint8Array(256)
		for (var ci = 0; ci < sc.cycles.length; ci++) {
			var c = sc.cycles[ci]
			for (var idy = c.low; idy <= c.high; idy++) optColors[idy] = 1
		}
		var count = 0
		var n = spx.length
		for (var j = 0; j < n; j++) if (optColors[spx[j]]) count++
		var optIdx = new Uint32Array(count)
		var q = 0
		for (j = 0; j < n; j++) if (optColors[spx[j]]) optIdx[q++] = j

		/* Bounding box of the animated pixels. Most scenes only animate a band
		 * (water, sky, torches), so blitting just this box instead of the whole
		 * backing store is the single cheapest win available on a slow device. */
		var bx0 = sw
		var by0 = sh
		var bx1 = -1
		var by1 = -1
		for (q = 0; q < optIdx.length; q++) {
			var bi = optIdx[q]
			var iy = (bi / sw) | 0
			var ix = bi - iy * sw
			if (ix < bx0) bx0 = ix
			if (ix > bx1) bx1 = ix
			if (iy < by0) by0 = iy
			if (iy > by1) by1 = iy
		}
		if (bx1 < 0) {
			bx0 = 0
			by0 = 0
			bx1 = sw - 1
			by1 = sh - 1
		}

		sc.spx = spx
		sc.optIdx = optIdx
		sc.scale = scale
		sc.sw = sw
		sc.sh = sh
		sc.adx = bx0
		sc.ady = by0
		sc.adw = bx1 - bx0 + 1
		sc.adh = by1 - by0 + 1
		sc.animPct = n ? Math.round((count / n) * 1000) / 10 : 0
		sc.boxPct = n ? Math.round(((sc.adw * sc.adh) / n) * 1000) / 10 : 0
	}

	/* =====================================================================
	 * 7. Renderer
	 * =================================================================== */

	var canvas = null
	var ctx = null
	var imgData = null
	var S = null // active scene
	var curIdx = -1
	var wantIdx = -1
	var loading = false
	var pendingIdx = -1
	var failed = {}

	var active = false // main screen visible
	var pauses = {} // reason -> true
	var pauseCount = 0
	var running = false
	var timerId = 0
	var startTick = nowMs()
	var lastTod = -1
	var needFull = true

	var extNow = 0 // ms, supplied by SmartHome updateClock()
	var extNowAt = 0
	var weather = null
	var lastMinute = -1
	var minutesSinceCheck = 1e9
	var bootTimer = 0 // pending first scene pick, see init()/setWeather()

	var stat = { frames: 0, work: 0, avg: 0, over: 0, drops: 0, lastFull: 0 }

	function getNow() {
		if (extNow && nowMs() - extNowAt < 5000) return new Date(extNow)
		return new Date()
	}

	function currentTimeOffset() {
		var d = getNow()
		var sec = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()
		var st = Q.todStep | 0
		return st > 1 ? Math.floor(sec / st) * st : sec
	}

	function shouldRun() {
		return !!(Q.enabled && active && pauseCount === 0 && S && ctx && hasTyped)
	}

	function startLoop() {
		if (running) return
		if (!shouldRun()) return
		running = true
		needFull = true
		schedule(0)
		log('[LW] loop start')
	}

	function stopLoop() {
		running = false
		if (timerId) {
			window.clearTimeout(timerId)
			timerId = 0
		}
	}

	/* Exactly one timer, ever. We deliberately do NOT use
	 * requestAnimationFrame: at a capped 10-20 fps it would wake the JS engine
	 * 60 times a second only to discard two thirds of the callbacks. */
	function schedule(work) {
		if (!running) return
		if (timerId) {
			window.clearTimeout(timerId)
			timerId = 0
		}
		/* While the quality panel is open the browser also has to composite
		 * and scroll a DOM overlay on top of the canvas, which on a Galaxy Ace
		 * costs more than the frame itself. Cap the renderer at Q.uiFps so the
		 * panel stays scrollable, then go back to full speed on close. */
		var fps = Q.fps || 15
		if (panel && Q.uiFps && Q.uiFps < fps) fps = Q.uiFps
		var interval = 1000 / fps
		var delay = interval - (work || 0)
		if (delay < 4) delay = 4
		timerId = window.setTimeout(step, delay)
	}

	function step() {
		timerId = 0
		if (!running) return
		if (!shouldRun()) {
			running = false
			return
		}

		var t0 = nowMs()
		var full = false

		var to = currentTimeOffset()
		if (to !== lastTod) {
			setTodPalette(S, to)
			lastTod = to
			full = true
			stat.lastFull = t0
		}
		if (needFull) {
			full = true
			needFull = false
		}

		if (Q.animate === false) {
			/* Light-only mode: between time-of-day steps nothing changes, so
			 * there is nothing to compute and nothing to blit. Just idle. */
			if (!full) {
				timerId = window.setTimeout(step, 1000)
				return
			}
			renderInto(S, imgData.data, true)
			ctx.putImageData(imgData, 0, 0)
		} else {
			cyclePalette(S, t0 - startTick, Q.speed, Q.blendShift)
			renderInto(S, imgData.data, full)
			if (!full && Q.dirty && S.adw && S.adw * S.adh < S.sw * S.sh) {
				ctx.putImageData(imgData, 0, 0, S.adx, S.ady, S.adw, S.adh)
			} else {
				ctx.putImageData(imgData, 0, 0)
			}
		}

		var work = nowMs() - t0
		stat.frames++
		stat.work = work
		stat.avg = stat.avg ? stat.avg * 0.9 + work * 0.1 : work

		if (Q.watchdog) watchdog(work)
		schedule(work)
	}

	/* If the device cannot keep up, step the preset down instead of letting
	 * the page grind itself to death. */
	function watchdog(work) {
		var interval = 1000 / (Q.fps || 15)
		if (work > interval * 1.5) stat.over++
		else if (stat.over > 0) stat.over--

		if (stat.over >= 120) {
			stat.over = 0
			var at = PRESET_ORDER.indexOf(Q.preset)
			if (at < 0) at = PRESET_ORDER.indexOf('low')
			if (at < PRESET_ORDER.length - 2) {
				var next = PRESET_ORDER[at + 1]
				stat.drops++
				log('[LW] watchdog: ' + Q.preset + ' -> ' + next + ' (avg ' + Math.round(stat.avg) + 'ms)')
				LW.setPreset(next)
			}
		}
	}

	/* =====================================================================
	 * 8. Canvas plumbing
	 * =================================================================== */

	/* ---- fullscreen hot spot -----------------------------------------
	 * Firefox for Android has no fullscreen button of its own, it only
	 * grants fullscreen from a real user gesture, and it leaves fullscreen
	 * on every reload, so the page needs a permanent button of its own.
	 * A one-shot listener on `document` does not work on the phone: the
	 * SmartHome swipe handler already owns document-level touchend, and
	 * Android Firefox does not reliably synthesise a `click` after a tap -
	 * which is why the first version only ever fired under a desktop mouse.
	 * So bind straight to one small element (by default the online status
	 * chip) and listen for touchend *and* click, every single time. */
	var fsTapEl = null
	var fsTapAt = 0
	var fsTapRetry = false

	function toggleFullscreen() {
		if (LW.isFullscreen()) return LW.exitFullscreen()
		return LW.fullscreen({ scrollTrick: true })
	}

	function fsTapHandler(ev) {
		/* One tap can deliver touchend and then click; take the first. */
		var t = nowMs()
		if (t - fsTapAt < 700) return
		fsTapAt = t
		toggleFullscreen()
		if (ev && ev.stopPropagation) ev.stopPropagation()
	}

	function bindFsTap() {
		if (!Q.fsOnTap || !document.addEventListener) return
		var sel = Q.fsTap || '#status-server'
		var el = null
		if (sel === 'screen' || sel === 'all' || sel === '*') el = document
		else {
			if (sel.charAt(0) === '#' && document.getElementById) el = document.getElementById(sel.substring(1))
			if (!el && document.querySelector) {
				try {
					el = document.querySelector(sel)
				} catch (eSel) {
					el = null
				}
			}
		}
		if (!el) {
			/* The element may simply not be parsed yet; try once more. */
			log('[LW] fullscreen hot spot not found: ' + sel)
			if (!fsTapRetry && window.setTimeout) {
				fsTapRetry = true
				window.setTimeout(bindFsTap, 2000)
			}
			return
		}
		if (el === fsTapEl) return
		if (fsTapEl && fsTapEl.removeEventListener) {
			fsTapEl.removeEventListener('touchend', fsTapHandler, false)
			fsTapEl.removeEventListener('click', fsTapHandler, false)
		}
		fsTapEl = el
		el.addEventListener('touchend', fsTapHandler, false)
		el.addEventListener('click', fsTapHandler, false)
		log('[LW] fullscreen hot spot: ' + sel)
	}

	var fsBound = false

	function onFsChange() {
		/* The viewport changes size on the way in and on the way out, and old
		 * Gecko reports the new size a beat late, so re-fit twice. */
		window.setTimeout(fitCanvas, 60)
		window.setTimeout(fitCanvas, 400)
	}

	function bindFsListeners() {
		if (fsBound || !document.addEventListener) return
		fsBound = true
		var evs = ['fullscreenchange', 'mozfullscreenchange', 'webkitfullscreenchange', 'MSFullscreenChange']
		for (var i = 0; i < evs.length; i++) document.addEventListener(evs[i], onFsChange, false)
	}

	function ensureCanvas() {
		if (canvas) return true
		canvas = document.getElementById('lw-canvas')
		if (!canvas) return false
		if (!canvas.getContext) {
			canvas = null
			return false
		}
		/* alpha:false lets Gecko skip per-pixel compositing of the canvas
		 * layer. Shipped in Firefox 30, harmlessly ignored elsewhere. */
		try {
			ctx = canvas.getContext('2d', { alpha: false })
		} catch (e) {
			ctx = null
		}
		if (!ctx) ctx = canvas.getContext('2d')
		if (!ctx) {
			canvas = null
			return false
		}
		if (ctx.mozImageSmoothingEnabled === true || ctx.mozImageSmoothingEnabled === false) ctx.mozImageSmoothingEnabled = false
		if (ctx.imageSmoothingEnabled === true || ctx.imageSmoothingEnabled === false) ctx.imageSmoothingEnabled = false
		return true
	}

	/* Create the backing store once per (scene, scale). Never per frame,
	 * never per minute. */
	function resizeBackingStore() {
		if (!S || !ensureCanvas()) return
		if (canvas.width !== S.sw || canvas.height !== S.sh || !imgData) {
			canvas.width = S.sw
			canvas.height = S.sh
			imgData = null
		}
		if (!imgData) {
			if (ctx.createImageData) imgData = ctx.createImageData(S.sw, S.sh)
			else if (ctx.getImageData) imgData = ctx.getImageData(0, 0, S.sw, S.sh)
			else return
			var d = imgData.data
			for (var i = 3, n = d.length; i < n; i += 4) d[i] = 255 // opaque once
		}
		needFull = true
		fitCanvas()
	}

	/* cover / contain / fill against the real element box, so nothing ever
	 * overflows the 320x480 screen and no scrollbars can appear. */
	function fitCanvas() {
		if (!canvas) return
		var host = canvas.parentNode
		var W = (host && host.clientWidth) || window.innerWidth || 320
		var H = (host && host.clientHeight) || window.innerHeight || 480
		var cw = S ? S.w : 640
		var ch = S ? S.h : 480
		var outW, outH

		if (Q.fit === 'fill') {
			outW = W
			outH = H
		} else {
			var sx = W / cw
			var sy = H / ch
			var sc = Q.fit === 'contain' ? (sx < sy ? sx : sy) : sx > sy ? sx : sy
			outW = Math.ceil(cw * sc)
			outH = Math.ceil(ch * sc)
		}
		canvas.style.width = outW + 'px'
		canvas.style.height = outH + 'px'
		canvas.style.left = Math.round((W - outW) * Q.focusX) + 'px'
		canvas.style.top = Math.round((H - outH) * Q.focusY) + 'px'
	}

	/* =====================================================================
	 * 9. Scene loading
	 * =================================================================== */

	function xhrBinary(url, cb, err) {
		var x = new XMLHttpRequest()
		x.open('GET', url, true)
		var useAB = false
		try {
			x.responseType = 'arraybuffer'
			useAB = x.responseType === 'arraybuffer'
		} catch (e) {
			useAB = false
		}
		if (!useAB && x.overrideMimeType) x.overrideMimeType('text/plain; charset=x-user-defined')
		x.onreadystatechange = function () {
			if (x.readyState !== 4) return
			if (x.status !== 200 && x.status !== 0) {
				err('http ' + x.status)
				return
			}
			try {
				var bytes
				if (useAB && x.response) {
					bytes = new Uint8Array(x.response)
				} else {
					var s = x.responseText || ''
					var n = s.length
					bytes = new Uint8Array(n)
					for (var i = 0; i < n; i++) bytes[i] = s.charCodeAt(i) & 0xff
				}
				cb(bytes)
			} catch (e2) {
				err('' + e2)
			}
		}
		try {
			x.send(null)
		} catch (e3) {
			err('' + e3)
		}
	}

	function freeScene(sc) {
		if (!sc) return
		sc.pixels = null
		sc.palBytes = null
		sc.spx = null
		sc.optIdx = null
		sc.basePal = null
		sc.curPal = null
		sc.tlOff = null
		sc.tlPal = null
		sc.cycles = null
	}

	function switchTo(idx) {
		if (idx < 0 || idx >= SCENES.length) return
		if (idx === curIdx && S) return
		if (failed[idx]) return
		if (loading) {
			pendingIdx = idx
			return
		}
		loading = true
		var meta = SCENES[idx]
		var url = Q.base + 'scenes/' + meta.file + '.lwb'
		log('[LW] loading ' + meta.title)

		xhrBinary(
			url,
			function (bytes) {
				loading = false
				var sc
				try {
					sc = parseLwb(bytes)
				} catch (e) {
					failed[idx] = true
					log('[LW] parse failed: ' + e)
					afterLoad()
					return
				}
				// Release the previous scene BEFORE allocating derived buffers,
				// so only one heavy scene is ever resident.
				var old = S
				S = null
				freeScene(old)

				buildScaled(sc, Q.scale)
				S = sc
				curIdx = idx
				lastTod = -1
				resizeBackingStore()
				log('[LW] ready: ' + sc.title + ' ' + sc.sw + 'x' + sc.sh + ' anim ' + sc.animPct + '%')
				afterLoad()
			},
			function (e) {
				loading = false
				failed[idx] = true
				log('[LW] load failed ' + url + ': ' + e)
				afterLoad()
			}
		)
	}

	function afterLoad() {
		if (pendingIdx >= 0 && pendingIdx !== curIdx) {
			var p = pendingIdx
			pendingIdx = -1
			switchTo(p)
			return
		}
		pendingIdx = -1
		if (shouldRun()) startLoop()
	}

	function evaluate(force) {
		if (!Q.enabled) return
		var d = getNow()
		var idx = pickScene(d.getMonth() + 1, d.getDate(), mapWeather(weather))
		if (idx === wantIdx && !force) return
		wantIdx = idx
		if (idx !== curIdx) switchTo(idx)
	}

	/* =====================================================================
	 * 10. Quality panel (created lazily, removed on close - no idle DOM)
	 * =================================================================== */

	var panel = null

	function closePanel() {
		if (panel && panel.parentNode) panel.parentNode.removeChild(panel)
		panel = null
	}

	function openPanel() {
		if (panel) {
			closePanel()
			return
		}
		var d = document.createElement('div')
		d.id = 'lw-panel'
		var html = ''
		html += '<div class="lw-h">Living Worlds</div>'
		html += '<div class="lw-i">' + (S ? S.title : 'нет сцены') + '</div>'
		html += '<div class="lw-i">' + (S ? S.sw + 'x' + S.sh + ' · аним ' + S.animPct + '% · бокс ' + S.boxPct + '%' : '') + ' · ' + Math.round(stat.avg) + ' мс/кадр</div>'
		html += row('Профиль', 'p', PANEL_ORDER, Q.preset)
		html += row('FPS', 'f', [4, 6, 8, 10, 15, 20, 30], Q.fps)
		html += row('Масштаб', 's', [1, 2, 3, 4, 6, 8], Q.scale)
		html += row('Сглаж.', 'b', [0, 1], Q.blendShift ? 1 : 0)
		html += row('Блит', 'd', [0, 1], Q.dirty ? 1 : 0)
		html += row('Анимация', 'a', [0, 1], Q.animate === false ? 0 : 1)
		html += row('Шаг света, с', 't', [15, 30, 60, 120, 300], Q.todStep)
		html += row('Кадр', 'c', ['cover', 'contain', 'fill'], Q.fit)
		html += '<div class="lw-r"><button data-k="z" data-v="1" class="lw-b">Во весь экран</button>'
		html += '<button data-k="r" data-v="1" class="lw-b">Из конфига</button>'
		html += '<button data-k="x" data-v="1" class="lw-b lw-close">Закрыть</button></div>'
		d.innerHTML = html
		document.body.appendChild(d)
		panel = d

		d.onclick = function (ev) {
			var t = (ev || window.event).target
			if (!t || !t.getAttribute) return
			var k = t.getAttribute('data-k')
			if (!k) return
			var v = t.getAttribute('data-v')
			if (k === 'x') return closePanel()
			if (k === 'p') LW.setPreset(v)
			if (k === 'f') LW.set({ fps: parseInt(v, 10) })
			if (k === 's') LW.set({ scale: parseInt(v, 10) })
			if (k === 'b') LW.set({ blendShift: v === '1' })
			if (k === 't') LW.set({ todStep: parseInt(v, 10) })
			if (k === 'c') LW.set({ fit: v })
			if (k === 'd') LW.set({ dirty: v === '1' })
			if (k === 'a') LW.set({ animate: v === '1' })
			if (k === 'r') {
				/* Drop the on-device tuning, go back to lw/config.js. */
				LW.resetPrefs()
				closePanel()
				openPanel()
				return
			}
			if (k === 'z') {
				/* This has to run inside the real tap handler: Gecko only grants
				 * fullscreen from a genuine user gesture. A second press leaves
				 * fullscreen again, since the phone shows no exit UI. */
				toggleFullscreen()
				closePanel()
				return
			}
			closePanel()
			openPanel()
		}
	}

	function row(label, key, vals, cur) {
		var h = '<div class="lw-r"><span class="lw-l">' + label + '</span>'
		for (var i = 0; i < vals.length; i++) {
			var v = vals[i]
			var on = '' + v === '' + cur ? ' lw-on' : ''
			var bool = key === 'b' || key === 'd' || key === 'a'
			var txt = bool ? (v === 1 ? 'on' : 'off') : v
			h += '<button class="lw-b' + on + '" data-k="' + key + '" data-v="' + v + '">' + txt + '</button>'
		}
		return h + '</div>'
	}

	/* Long press on the clock area opens the panel. No permanent controls,
	 * no audio controls, nothing added to the normal UI. */
	function bindGesture() {
		var host = document.getElementById('box-clock') || document.getElementById('page-clock')
		if (!host) return
		var timer = 0
		var sx = 0
		var sy = 0
		var cancel = function () {
			if (timer) {
				window.clearTimeout(timer)
				timer = 0
			}
		}
		var start = function (ev) {
			var t = ev.touches && ev.touches[0]
			sx = t ? t.clientX : ev.clientX || 0
			sy = t ? t.clientY : ev.clientY || 0
			cancel()
			timer = window.setTimeout(function () {
				timer = 0
				openPanel()
			}, 1000)
		}
		var move = function (ev) {
			var t = ev.touches && ev.touches[0]
			var x = t ? t.clientX : ev.clientX || 0
			var y = t ? t.clientY : ev.clientY || 0
			if (Math.abs(x - sx) > 12 || Math.abs(y - sy) > 12) cancel()
		}
		host.addEventListener('touchstart', start, false)
		host.addEventListener('touchmove', move, false)
		host.addEventListener('touchend', cancel, false)

		/* Kiosk helper (fullscreenOnTap): wire up the fullscreen hot spot. */
		bindFsTap()
		host.addEventListener('touchcancel', cancel, false)
		host.addEventListener('mousedown', start, false)
		host.addEventListener('mousemove', move, false)
		host.addEventListener('mouseup', cancel, false)
	}

	/* =====================================================================
	 * 11. Public API
	 * =================================================================== */

	var LW = {
		version: VERSION,
		scenes: SCENES,

		init: function (opts) {
			if (LW._inited) return LW
			LW._inited = true
			loadPrefs()
			if (opts) for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) Q[k] = opts[k]

			if (!hasTyped) {
				log('[LW] typed arrays missing - disabled')
				Q.enabled = false
				return LW
			}
			if (!ensureCanvas()) {
				log('[LW] #lw-canvas not found - disabled')
				Q.enabled = false
				return LW
			}

			var pc = document.getElementById('page-clock')
			active = pc ? pc.className.indexOf('active') >= 0 : true

			if (window.addEventListener) {
				window.addEventListener(
					'resize',
					function () {
						fitCanvas()
					},
					false
				)
				window.addEventListener(
					'orientationchange',
					function () {
						fitCanvas()
					},
					false
				)
				document.addEventListener(
					'visibilitychange',
					function () {
						if (document.hidden) LW.pause('hidden')
						else LW.resume('hidden')
					},
					false
				)
			}
			bindGesture()

			/* The first scene pick waits a moment for the weather payload that
			 * SmartHome's own fetchData() is already retrieving. Without this we
			 * would load the clear scene and throw it away milliseconds later:
			 * two 310 KB reads and two 640x480 decodes on a device that can
			 * barely afford one. If nothing arrives in time we fall back to
			 * clear, which is what the naive order would have shown anyway. */
			if (Q.initDelay > 0 && window.setTimeout) {
				bootTimer = window.setTimeout(function () {
					bootTimer = 0
					evaluate(true)
				}, Q.initDelay)
			} else {
				evaluate(true)
			}
			LW.setActive(active)
			return LW
		},

		/* Called from SmartHome updateClock() - SmartHome stays the single
		 * source of truth for time, date and month. No extra timer. */
		tick: function (date) {
			var d = date || new Date()
			extNow = d.getTime()
			extNowAt = nowMs()

			// Follow the existing burn-in / deep-sleep state without extra hooks.
			var cn = document.body ? document.body.className : ''
			var asleep = cn.indexOf('deep-sleep-mini') >= 0
			if (asleep && !pauses.sleep) LW.pause('sleep')
			else if (!asleep && pauses.sleep) LW.resume('sleep')

			var m = d.getMinutes()
			if (m !== lastMinute) {
				lastMinute = m
				minutesSinceCheck++
				if (minutesSinceCheck >= (Q.sceneCheckMin || 5)) {
					minutesSinceCheck = 0
					evaluate(false)
				}
			}
		},

		/* Called from SmartHome updateWeather() with the existing weatherData
		 * object. No new API call, no extra polling. */
		setWeather: function (wd) {
			if (!wd) return
			var before = mapWeather(weather)
			weather = wd
			var after = mapWeather(wd)

			// First payload arrived before the boot grace period expired:
			// pick the right scene straight away and load it exactly once.
			if (bootTimer) {
				window.clearTimeout(bootTimer)
				bootTimer = 0
				minutesSinceCheck = 0
				evaluate(true)
				return
			}

			if (after !== before) {
				minutesSinceCheck = 0
				evaluate(false)
			}
		},

		/* Called from SmartHome showPage(n) with (n === 0). */
		setActive: function (on) {
			on = !!on
			active = on
			if (canvas) canvas.style.display = on && Q.enabled ? 'block' : 'none'
			if (on) {
				if (S) {
					needFull = true
					fitCanvas()
				}
				startLoop()
			} else {
				stopLoop()
			}
		},

		pause: function (reason) {
			reason = reason || 'manual'
			if (pauses[reason]) return
			pauses[reason] = true
			pauseCount++
			stopLoop()
		},

		resume: function (reason) {
			reason = reason || 'manual'
			if (!pauses[reason]) return
			delete pauses[reason]
			pauseCount--
			if (pauseCount < 0) pauseCount = 0
			needFull = true
			startLoop()
		},

		set: function (opts) {
			var reScale = false
			var reFit = false
			for (var k in opts) {
				if (!Object.prototype.hasOwnProperty.call(opts, k)) continue
				if (k === 'scale' && opts[k] !== Q.scale) reScale = true
				if (k === 'fit' || k === 'focusX' || k === 'focusY') reFit = true
				Q[k] = opts[k]
			}
			if (reScale && S) {
				stopLoop()
				buildScaled(S, Q.scale)
				resizeBackingStore()
			}
			if (reFit) fitCanvas()
			if (!Q.enabled) {
				stopLoop()
				if (canvas) canvas.style.display = 'none'
			} else {
				if (canvas) canvas.style.display = active ? 'block' : 'none'
				needFull = true
				startLoop()
			}
			savePrefs()
			return LW
		},

		setPreset: function (name) {
			if (!PRESETS[name]) return LW
			var oldScale = Q.scale
			applyPreset(name)
			stat.over = 0
			if (Q.scale !== oldScale && S) {
				stopLoop()
				buildScaled(S, Q.scale)
				resizeBackingStore()
			}
			if (!Q.enabled) {
				stopLoop()
				if (canvas) canvas.style.display = 'none'
			} else {
				if (canvas) canvas.style.display = active ? 'block' : 'none'
				needFull = true
				startLoop()
			}
			savePrefs()
			return LW
		},

		/* Forget everything tuned on the device and re-read lw/config.js.
		 * Deliberately does NOT save, so the next reload reads the file too. */
		resetPrefs: function () {
			try {
				if (window.localStorage) window.localStorage.removeItem(STORE_KEY)
			} catch (e) {}
			var oldScale = Q.scale
			if (CFG && CFG.preset && PRESETS[CFG.preset]) applyPreset(CFG.preset)
			else applyPreset('ace')
			applyConfig(CFG)
			stat.over = 0
			if (Q.scale !== oldScale && S) {
				stopLoop()
				buildScaled(S, Q.scale)
				resizeBackingStore()
			}
			fitCanvas()
			needFull = true
			startLoop()
			return LW
		},
		ui: openPanel,
		closeUi: closePanel,

		/* Diagnostics / manual override, handy over adb or a desktop browser. */
		/* ---- fullscreen -------------------------------------------------
		 * Firefox for Android has no fullscreen button in its UI, but Gecko
		 * has shipped the prefixed Fullscreen API since 9.0, so even 31.0 can
		 * do it from a real tap. Every known spelling is tried in order and
		 * the winning one is returned so the caller can report it. */
		fullscreen: function (opts) {
			opts = opts || {}
			bindFsListeners()
			var el = opts.element || document.documentElement || document.body
			var names = [
				'requestFullscreen',
				'mozRequestFullScreen',
				'webkitRequestFullscreen',
				'webkitRequestFullScreen',
				'msRequestFullscreen',
			]
			for (var i = 0; i < names.length; i++) {
				if (el && typeof el[names[i]] === 'function') {
					try {
						el[names[i]]()
						onFsChange()
						return names[i]
					} catch (e) {}
				}
			}
			/* Last resort for browsers with no API at all: make the document
			 * one screen taller and scroll by a pixel, which retracts the URL
			 * bar. Opt-in, because it needs a page that is allowed to scroll. */
			if (opts.scrollTrick) {
				try {
					document.documentElement.style.minHeight = ((window.innerHeight || 480) + 120) + 'px'
					window.setTimeout(function () {
						window.scrollTo(0, 1)
						onFsChange()
					}, 0)
					return 'scrollTrick'
				} catch (e2) {}
			}
			return null
		},

		/* Enter fullscreen, or leave it if already there. Safe to call from
		 * any tap handler, which is what the status chip does. */
		toggleFullscreen: function () {
			return toggleFullscreen()
		},

		/* Move the fullscreen hot spot at runtime, e.g. LW.fsTap('#clock-time')
		 * or LW.fsTap('screen') for the whole page. */
		fsTap: function (sel) {
			if (typeof sel === 'string' && sel) {
				Q.fsTap = sel
				Q.fsOnTap = true
				fsTapRetry = false
				savePrefs()
			}
			bindFsTap()
			return fsTapEl ? Q.fsTap : null
		},

		exitFullscreen: function () {
			var names = ['exitFullscreen', 'mozCancelFullScreen', 'webkitExitFullscreen', 'webkitCancelFullScreen', 'msExitFullscreen']
			for (var i = 0; i < names.length; i++) {
				if (typeof document[names[i]] === 'function') {
					try {
						document[names[i]]()
						return names[i]
					} catch (e) {}
				}
			}
			return null
		},

		isFullscreen: function () {
			return !!(
				document.fullscreenElement ||
				document.mozFullScreenElement ||
				document.webkitFullscreenElement ||
				document.msFullscreenElement ||
				document.mozFullScreen ||
				document.webkitIsFullScreen
			)
		},

		/* ---- benchmark --------------------------------------------------
		 * Times the real per-frame work (cycle + render + blit) for a list of
		 * scales, synchronously, and reports the frame rate each one could
		 * sustain. Restores the previous scale before returning. */
		bench: function (opts) {
			opts = opts || {}
			if (!S || !ensureCanvas()) return null
			var scales = opts.scales || [1, 2, 3, 4, 5, 6]
			var iters = opts.iters || 16
			var wasScale = S.scale
			var out = []
			var i, k, t0, ms, sc

			for (i = 0; i < scales.length; i++) {
				sc = scales[i]
				if (sc < 1 || sc > 8) continue
				buildScaled(S, sc)
				resizeBackingStore()
				if (!imgData) continue
				setTodPalette(S, currentTimeOffset())
				renderInto(S, imgData.data, true)
				ctx.putImageData(imgData, 0, 0)

				t0 = nowMs()
				for (k = 0; k < iters; k++) {
					cyclePalette(S, t0 - startTick + k * 40, Q.speed, Q.blendShift)
					renderInto(S, imgData.data, false)
					if (Q.dirty && S.adw && S.adw * S.adh < S.sw * S.sh) ctx.putImageData(imgData, 0, 0, S.adx, S.ady, S.adw, S.adh)
					else ctx.putImageData(imgData, 0, 0)
				}
				ms = (nowMs() - t0) / iters

				out.push({
					scale: sc,
					w: S.sw,
					h: S.sh,
					px: S.sw * S.sh,
					ms: Math.round(ms * 100) / 100,
					maxFps: ms > 0 ? Math.floor(1000 / ms) : 999,
					animPct: S.animPct,
					boxPct: S.boxPct,
				})
			}

			buildScaled(S, wasScale)
			resizeBackingStore()
			needFull = true
			return out
		},

		forceScene: function (idx) {
			wantIdx = idx
			switchTo(idx)
		},
		status: function () {
			return {
				version: VERSION,
				scene: S ? S.title : null,
				sceneIdx: curIdx,
				mode: mapWeather(weather),
				weather: weather ? { main: weather.main, icon: weather.icon } : null,
				running: running,
				active: active,
				paused: pauseCount > 0,
				timeOffset: lastTod,
				backing: S ? S.sw + 'x' + S.sh : null,
				animPct: S ? S.animPct : null,
				boxPct: S ? S.boxPct : null,
				dirtyRect: S && S.adw ? S.adx + ',' + S.ady + ' ' + S.adw + 'x' + S.adh : null,
				fullscreen: !!(document.fullscreenElement || document.mozFullScreenElement || document.webkitFullscreenElement || document.msFullscreenElement),
				avgMs: Math.round(stat.avg * 10) / 10,
				frames: stat.frames,
				drops: stat.drops,
				quality: Q,
			}
		},

		/* Exposed for tools/verify-engine.js - not used by the browser. */
		_core: {
			dmod: dmod,
			fade1: fade1,
			applyCycle: applyCycle,
			cyclePalette: cyclePalette,
			setTodPalette: setTodPalette,
			renderInto: renderInto,
			parseLwb: parseLwb,
			buildScaled: buildScaled,
			mapWeather: mapWeather,
			pickScene: pickScene,
			quality: Q,
			presets: PRESETS,
		},
	}

	window.LW = LW
	if (typeof module !== 'undefined' && module.exports) module.exports = LW
})(typeof window !== 'undefined' ? window : global, typeof document !== 'undefined' ? document : {})
