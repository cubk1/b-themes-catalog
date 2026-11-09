var HUES = [0, 41, 61, 101, 131, 181, 251, 301, 360];
var VIBRANT_SECONDARY = [18, 15, 10, 12, 15, 18, 15, 12, 12];
var VIBRANT_TERTIARY = [35, 30, 20, 25, 30, 35, 30, 25, 25];
var EXPRESSIVE_SECONDARY = [45, 95, 45, 20, 45, 90, 45, 45, 45];
var EXPRESSIVE_TERTIARY = [120, 120, 20, 45, 20, 15, 20, 120, 120];
var FALLBACK_SEED = 0xFF4285F4;

function clamp(low, high, value) {
    return value < low ? low : value > high ? high : value;
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function cbrt(x) {
    return x < 0 ? -Math.pow(-x, 1 / 3) : Math.pow(x, 1 / 3);
}

function signum(x) {
    return x < 0 ? -1 : x > 0 ? 1 : 0;
}

function wrap(hue) {
    var h = hue % 360;
    return h < 0 ? h + 360 : h;
}

function argbOf(r, g, b) {
    return ((255 * 256 + r) * 256 + g) * 256 + b;
}

function redOf(c) {
    return (c >>> 16) & 255;
}

function greenOf(c) {
    return (c >>> 8) & 255;
}

function blueOf(c) {
    return c & 255;
}

function linearized(component) {
    var n = component / 255;
    return n <= 0.040449936 ? (n / 12.92) * 100 : Math.pow((n + 0.055) / 1.055, 2.4) * 100;
}

function delinearized(component) {
    var n = component / 100;
    var d = n <= 0.0031308 ? n * 12.92 : 1.055 * Math.pow(n, 1 / 2.4) - 0.055;
    return clamp(0, 255, Math.round(d * 255));
}

function labF(t) {
    return t > 216 / 24389 ? cbrt(t) : ((24389 / 27) * t + 16) / 116;
}

function labInvf(ft) {
    var cube = ft * ft * ft;
    return cube > 216 / 24389 ? cube : (116 * ft - 16) / (24389 / 27);
}

function yFromLstar(lstar) {
    return 100 * labInvf((lstar + 16) / 116);
}

function lstarOf(argb) {
    var y = 0.2126 * linearized(redOf(argb)) + 0.7152 * linearized(greenOf(argb)) + 0.0722 * linearized(blueOf(argb));
    return 116 * labF(y / 100) - 16;
}

function grayOf(lstar) {
    var c = delinearized(yFromLstar(lstar));
    return argbOf(c, c, c);
}

function argbFromXyz(x, y, z) {
    return argbOf(delinearized(3.2413774792388685 * x - 1.5376652402851851 * y - 0.49885366846268053 * z),
                  delinearized(-0.9691452513005321 * x + 1.8758853451067872 * y + 0.04156585616912061 * z),
                  delinearized(0.05562093689691305 * x - 0.20395524564742123 * y + 1.0571799111220335 * z));
}

var VIEW = (function () {
    var white = [95.047, 100, 108.883];
    var adapting = ((200 / Math.PI) * yFromLstar(50)) / 100;
    var rW = white[0] * 0.401288 + white[1] * 0.650173 + white[2] * -0.051461;
    var gW = white[0] * -0.250268 + white[1] * 1.204414 + white[2] * 0.045854;
    var bW = white[0] * -0.002079 + white[1] * 0.048952 + white[2] * 0.953127;
    var f = 0.8 + 2 / 10;
    var c = f >= 0.9 ? lerp(0.59, 0.69, (f - 0.9) * 10) : lerp(0.525, 0.59, (f - 0.8) * 10);
    var d = clamp(0, 1, f * (1 - (1 / 3.6) * Math.exp((-adapting - 42) / 92)));
    var rgbD = [d * (100 / rW) + 1 - d, d * (100 / gW) + 1 - d, d * (100 / bW) + 1 - d];
    var k = 1 / (5 * adapting + 1);
    var k4 = k * k * k * k;
    var k4F = 1 - k4;
    var fl = k4 * adapting + 0.1 * k4F * k4F * cbrt(5 * adapting);
    var n = yFromLstar(50) / white[1];
    var nbb = 0.725 / Math.pow(n, 0.2);
    var factors = [Math.pow((fl * rgbD[0] * rW) / 100, 0.42), Math.pow((fl * rgbD[1] * gW) / 100, 0.42),
                   Math.pow((fl * rgbD[2] * bW) / 100, 0.42)];
    var rgbA = [(400 * factors[0]) / (factors[0] + 27.13), (400 * factors[1]) / (factors[1] + 27.13),
                (400 * factors[2]) / (factors[2] + 27.13)];
    return {
        n: n,
        aw: (2 * rgbA[0] + rgbA[1] + 0.05 * rgbA[2]) * nbb,
        nbb: nbb,
        ncb: nbb,
        c: c,
        nc: f,
        rgbD: rgbD,
        fl: fl,
        flRoot: Math.pow(fl, 0.25),
        z: 1.48 + Math.sqrt(n)
    };
})();

function camOf(hue, chroma, j) {
    var m = chroma * VIEW.flRoot;
    var radians = (hue * Math.PI) / 180;
    var mstar = Math.log(1 + 0.0228 * m) / 0.0228;
    return {
        hue: hue,
        chroma: chroma,
        j: j,
        jstar: (1.7 * j) / (1 + 0.007 * j),
        astar: mstar * Math.cos(radians),
        bstar: mstar * Math.sin(radians)
    };
}

function camFromArgb(argb) {
    var rL = linearized(redOf(argb));
    var gL = linearized(greenOf(argb));
    var bL = linearized(blueOf(argb));
    var x = 0.41233895 * rL + 0.35762064 * gL + 0.18051042 * bL;
    var y = 0.2126 * rL + 0.7152 * gL + 0.0722 * bL;
    var z = 0.01932141 * rL + 0.11916382 * gL + 0.95034478 * bL;
    var rD = VIEW.rgbD[0] * (0.401288 * x + 0.650173 * y - 0.051461 * z);
    var gD = VIEW.rgbD[1] * (-0.250268 * x + 1.204414 * y + 0.045854 * z);
    var bD = VIEW.rgbD[2] * (-0.002079 * x + 0.048952 * y + 0.953127 * z);
    var rF = Math.pow((VIEW.fl * Math.abs(rD)) / 100, 0.42);
    var gF = Math.pow((VIEW.fl * Math.abs(gD)) / 100, 0.42);
    var bF = Math.pow((VIEW.fl * Math.abs(bD)) / 100, 0.42);
    var rA = (signum(rD) * 400 * rF) / (rF + 27.13);
    var gA = (signum(gD) * 400 * gF) / (gF + 27.13);
    var bA = (signum(bD) * 400 * bF) / (bF + 27.13);
    var a = (11 * rA - 12 * gA + bA) / 11;
    var b = (rA + gA - 2 * bA) / 9;
    var u = (20 * rA + 20 * gA + 21 * bA) / 20;
    var p2 = (40 * rA + 20 * gA + bA) / 20;
    var hue = wrap((Math.atan2(b, a) * 180) / Math.PI);
    var j = 100 * Math.pow((p2 * VIEW.nbb) / VIEW.aw, VIEW.c * VIEW.z);
    var huePrime = hue < 20.14 ? hue + 360 : hue;
    var eHue = 0.25 * (Math.cos((huePrime * Math.PI) / 180 + 2) + 3.8);
    var p1 = (50000 / 13) * eHue * VIEW.nc * VIEW.ncb;
    var t = (p1 * Math.sqrt(a * a + b * b)) / (u + 0.305);
    var alpha = Math.pow(t, 0.9) * Math.pow(1.64 - Math.pow(0.29, VIEW.n), 0.73);
    return camOf(hue, alpha * Math.sqrt(j / 100), j);
}

function unadapt(component) {
    var base = Math.max(0, (27.13 * Math.abs(component)) / (400 - Math.abs(component)));
    return signum(component) * (100 / VIEW.fl) * Math.pow(base, 1 / 0.42);
}

function viewed(cam) {
    var alpha = cam.chroma === 0 || cam.j === 0 ? 0 : cam.chroma / Math.sqrt(cam.j / 100);
    var t = Math.pow(alpha / Math.pow(1.64 - Math.pow(0.29, VIEW.n), 0.73), 1 / 0.9);
    var radians = (cam.hue * Math.PI) / 180;
    var eHue = 0.25 * (Math.cos(radians + 2) + 3.8);
    var ac = VIEW.aw * Math.pow(cam.j / 100, 1 / VIEW.c / VIEW.z);
    var p1 = eHue * (50000 / 13) * VIEW.nc * VIEW.ncb;
    var p2 = ac / VIEW.nbb;
    var hSin = Math.sin(radians);
    var hCos = Math.cos(radians);
    var gamma = (23 * (p2 + 0.305) * t) / (23 * p1 + 11 * t * hCos + 108 * t * hSin);
    var a = gamma * hCos;
    var b = gamma * hSin;
    var rF = unadapt((460 * p2 + 451 * a + 288 * b) / 1403) / VIEW.rgbD[0];
    var gF = unadapt((460 * p2 - 891 * a - 261 * b) / 1403) / VIEW.rgbD[1];
    var bF = unadapt((460 * p2 - 220 * a - 6300 * b) / 1403) / VIEW.rgbD[2];
    return argbFromXyz(1.86206786 * rF - 1.01125463 * gF + 0.14918677 * bF,
                       0.38752654 * rF + 0.62144744 * gF - 0.00897398 * bF,
                       -0.0158415 * rF - 0.03412294 * gF + 1.04996444 * bF);
}

function camDistance(a, b) {
    var dj = a.jstar - b.jstar;
    var da = a.astar - b.astar;
    var db = a.bstar - b.bstar;
    return 1.41 * Math.pow(Math.sqrt(dj * dj + da * da + db * db), 0.63);
}

function findByJ(hue, chroma, tone) {
    var low = 0;
    var high = 100;
    var bestL = 1000;
    var bestE = 1000;
    var best = null;
    while (Math.abs(low - high) > 0.01) {
        var mid = low + (high - low) / 2;
        var clipped = viewed(camOf(hue, chroma, mid));
        var clippedL = lstarOf(clipped);
        var dL = Math.abs(tone - clippedL);
        if (dL < 0.2) {
            var cam = camFromArgb(clipped);
            var dE = camDistance(cam, camOf(hue, cam.chroma, cam.j));
            if (dE <= 1 && dE <= bestE) {
                bestL = dL;
                bestE = dE;
                best = cam;
            }
        }
        if (bestL === 0 && bestE === 0) {
            break;
        }
        if (clippedL < tone) {
            low = mid;
        } else {
            high = mid;
        }
    }
    return best;
}

function hct(hue, chroma, tone) {
    if (chroma < 1 || Math.round(tone) <= 0 || Math.round(tone) >= 100) {
        return grayOf(tone);
    }
    hue = wrap(hue);
    var high = chroma;
    var mid = chroma;
    var low = 0;
    var first = true;
    var answer = null;
    while (Math.abs(low - high) >= 0.4) {
        var found = findByJ(hue, mid, tone);
        if (first) {
            if (found !== null) {
                return viewed(found);
            }
            first = false;
        } else if (found === null) {
            high = mid;
        } else {
            answer = found;
            low = mid;
        }
        mid = low + (high - low) / 2;
    }
    return answer === null ? grayOf(tone) : viewed(answer);
}

function toHct(argb) {
    var cam = camFromArgb(argb);
    return { h: cam.hue, c: cam.chroma, t: lstarOf(argb) };
}

function harmonize(design, key) {
    var from = toHct(design);
    var to = toHct(key);
    var difference = 180 - Math.abs(Math.abs(from.h - to.h) - 180);
    var direction = wrap(to.h - from.h) <= 180 ? 1 : -1;
    return hct(wrap(from.h + Math.min(difference * 0.5, 15) * direction), from.c, from.t);
}

function imageSeed(image) {
    var pixels = image.pixels;
    var buckets = {};
    var keys = [];
    var total = pixels.length;
    for (var i = 0; i < pixels.length; i++) {
        var p = pixels[i];
        var key = ((p >>> 20) & 15) * 256 + ((p >>> 12) & 15) * 16 + ((p >>> 4) & 15);
        var bucket = buckets[key];
        if (!bucket) {
            bucket = buckets[key] = { n: 0, r: 0, g: 0, b: 0 };
            keys.push(key);
        }
        bucket.n++;
        bucket.r += redOf(p);
        bucket.g += greenOf(p);
        bucket.b += blueOf(p);
    }
    var population = [];
    for (var h = 0; h < 360; h++) {
        population.push(0);
    }
    var candidates = [];
    for (i = 0; i < keys.length; i++) {
        var item = buckets[keys[i]];
        var argb = argbOf(Math.round(item.r / item.n), Math.round(item.g / item.n), Math.round(item.b / item.n));
        var value = toHct(argb);
        var hue = Math.floor(value.h) % 360;
        population[hue] += item.n;
        candidates.push({ argb: argb, chroma: value.c, hue: hue });
    }
    var best = FALLBACK_SEED;
    var bestScore = -Infinity;
    for (i = 0; i < candidates.length; i++) {
        var candidate = candidates[i];
        var excited = 0;
        for (var d = -14; d < 16; d++) {
            excited += population[(candidate.hue + d + 360) % 360];
        }
        var proportion = total > 0 ? excited / total : 0;
        if (candidate.chroma < 5 || proportion <= 0.01) {
            continue;
        }
        var score = proportion * 70 + (candidate.chroma - 48) * (candidate.chroma < 48 ? 0.1 : 0.3);
        if (score > bestScore) {
            bestScore = score;
            best = candidate.argb;
        }
    }
    return best;
}

function rotated(hue, rotations) {
    for (var i = 0; i < HUES.length - 1; i++) {
        if (hue >= HUES[i] && hue < HUES[i + 1]) {
            return wrap(hue + rotations[i]);
        }
    }
    return hue;
}

function palettes(seed, variant) {
    var s = toHct(seed);
    var h = s.h;
    var c = s.c;
    if (variant == "vibrant") {
        return {
            primary: [h, 200],
            secondary: [rotated(h, VIBRANT_SECONDARY), 24],
            tertiary: [rotated(h, VIBRANT_TERTIARY), 32],
            neutral: [h, 10],
            neutralVariant: [h, 12]
        };
    }
    if (variant == "expressive") {
        return {
            primary: [wrap(h + 240), 40],
            secondary: [rotated(h, EXPRESSIVE_SECONDARY), 24],
            tertiary: [rotated(h, EXPRESSIVE_TERTIARY), 32],
            neutral: [wrap(h + 15), 8],
            neutralVariant: [wrap(h + 15), 12]
        };
    }
    if (variant == "neutral") {
        return {
            primary: [h, 12],
            secondary: [h, 8],
            tertiary: [wrap(h + 60), 16],
            neutral: [h, 2],
            neutralVariant: [h, 2]
        };
    }
    if (variant == "fidelity") {
        var muted = Math.max(c - 32, c * 0.5);
        return {
            primary: [h, c],
            secondary: [h, muted],
            tertiary: [wrap(h + 60), muted],
            neutral: [h, c / 8],
            neutralVariant: [h, c / 8 + 4]
        };
    }
    return {
        primary: [h, 36],
        secondary: [h, 16],
        tertiary: [wrap(h + 60), 24],
        neutral: [h, 6],
        neutralVariant: [h, 8]
    };
}

function scheme(seed, variant, light) {
    var p = palettes(seed, variant);
    function pick(palette, dark, bright) {
        return hct(palette[0], palette[1], light ? bright : dark);
    }
    var error = [25, 84];
    return {
        primary: pick(p.primary, 80, 40),
        onPrimary: pick(p.primary, 20, 100),
        primaryContainer: pick(p.primary, 30, 90),
        inversePrimary: pick(p.primary, 40, 80),
        secondaryContainer: pick(p.secondary, 30, 90),
        onSecondaryContainer: pick(p.secondary, 90, 10),
        tertiary: pick(p.tertiary, 80, 40),
        error: pick(error, 80, 40),
        surface: pick(p.neutral, 6, 98),
        surfaceContainerLow: pick(p.neutral, 10, 96),
        surfaceContainer: pick(p.neutral, 12, 94),
        surfaceContainerHigh: pick(p.neutral, 17, 92),
        surfaceContainerHighest: pick(p.neutral, 22, 90),
        onSurface: pick(p.neutral, 90, 10),
        onSurfaceVariant: pick(p.neutralVariant, 80, 30),
        outline: pick(p.neutralVariant, 60, 50),
        outlineVariant: pick(p.neutralVariant, 30, 80),
        inverseSurface: pick(p.neutral, 90, 20),
        inverseOnSurface: pick(p.neutral, 20, 95),
        shadow: hct(p.neutral[0], p.neutral[1], 0),
        scrim: hct(p.neutral[0], p.neutral[1], 0)
    };
}

function seedOf(env) {
    var source = env.settings.source || env.options.source;
    if (source == "背景图" && env.image) {
        return imageSeed(env.image);
    }
    if (source == "系统强调色" && env.system.accent !== null) {
        return env.system.accent;
    }
    return env.accent;
}

function colors(env) {
    var light = env.light;
    var s = scheme(seedOf(env), env.settings.variant || env.options.variant || "tonal-spot", light);
    var success = harmonize(light ? color.parse("#2E7D32") : color.parse("#81C995"), s.primary);
    var warning = harmonize(light ? color.parse("#B26A00") : color.parse("#F2B25C"), s.primary);
    return {
        shell: s.surfaceContainer,
        sidebar: s.surfaceContainer,
        panel: s.surface,
        surface: s.surfaceContainerLow,
        surfaceRaised: s.surfaceContainerHighest,
        surfaceSunken: s.surfaceContainerHighest,
        menu: s.surfaceContainer,
        toolbar: color.alpha(s.surfaceContainer, 220),
        docSurface: s.surfaceContainerLow,
        textPrimary: s.onSurface,
        textSecondary: s.onSurface,
        textMuted: s.onSurfaceVariant,
        textFaint: s.outline,
        outline: s.outlineVariant,
        outlineSoft: color.mix(s.outlineVariant, s.surface, 0.4),
        panelOutline: s.outlineVariant,
        groupOutline: s.outlineVariant,
        divider: color.alpha(s.outlineVariant, 160),
        overlay: s.onSurface,
        hover: color.alpha(s.onSurface, 20),
        hoverStrong: color.alpha(s.onSurface, 31),
        navHover: color.alpha(s.onSurface, 26),
        rowHover: s.surfaceContainerHigh,
        accent: s.primary,
        accentSoft: s.secondaryContainer,
        accentText: s.primary,
        onAccent: s.onPrimary,
        accentHover: s.onPrimary,
        accent2: s.tertiary,
        danger: s.error,
        dangerSoft: s.error,
        success: success,
        warning: warning,
        warningInk: warning,
        caution: warning,
        selection: color.alpha(s.primary, light ? 90 : 110),
        logSelection: color.alpha(s.primary, light ? 71 : 102),
        knob: s.onPrimary,
        knobOff: s.outline,
        knobShadow: color.alpha(s.shadow, light ? 46 : 0),
        pickerRing: s.onSurface,
        brandShadow: color.alpha(s.shadow, 0),
        scrollTrack: color.alpha(s.onSurface, 14),
        scrollThumb: s.outlineVariant,
        shadow: color.alpha(s.shadow, light ? 40 : 90),
        scrim: color.alpha(s.scrim, light ? 71 : 128),
        modalScrim: color.alpha(s.scrim, 102),
        toastFill: color.alpha(s.inverseSurface, 235),
        toastText: s.inverseOnSurface,
        toastInfo: s.inverseOnSurface,
        toastDone: s.inversePrimary,
        toastFailed: harmonize(color.parse("#E74C4C"), s.primary),
        $containerHigh: s.surfaceContainerHigh,
        $secondaryContainer: s.secondaryContainer
    };
}

var RIPPLE_SPEED = 800;
var RIPPLE_ALPHA = 0.3;

function easeOutCubic(t) {
    var u = 1 - t;
    return 1 - u * u * u;
}

function press(e) {
    var maxRadius = Math.max((e.width - e.x) * 2, e.x * 2) * 1.5;
    var t = Math.min(1, e.age / RIPPLE_SPEED);
    var progress = maxRadius * easeOutCubic(t);
    var alpha = RIPPLE_ALPHA;
    if (!e.down) {
        var release = easeOutCubic(Math.min(1, e.held / RIPPLE_SPEED));
        var fade = release >= 1 ? 1 : (progress / maxRadius - release) / (1 - release);
        alpha = RIPPLE_ALPHA * (1 - Math.min(1, fade));
        if (t >= 1 || alpha <= 0) {
            return null;
        }
    }
    return [{ circle: [e.x, e.y, progress], color: color.alpha(e.ink, Math.round(alpha * 255)) }];
}
