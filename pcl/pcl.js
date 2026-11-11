function pick(env) {
    var o = env.options || {};
    var hue = o.hue, sat = o.sat, adj = o.light || 0;
    if (o.custom) {
        var hsl = color.toHsl(env.accent);
        var s = hsl.s <= 1 ? hsl.s * 100 : hsl.s;
        var l = hsl.l <= 1 ? hsl.l * 100 : hsl.l;
        hue = hsl.h;
        sat = Math.max(20, Math.min(95, s));
        adj = Math.max(-20, Math.min(20, (l - 50) * 0.4));
    }
    if (o.cycle) {
        hue = ((o.seed || 0) + (env.time || 0) * 40) % 360;
    }
    return { hue: hue, sat: sat, adj: adj, o: o };
}

function colors(env) {
    var p = pick(env), h = p.hue, s = p.sat, a = p.adj, o = p.o;
    var c = function (dh, ss, l) { return color.hsl2(h + dh, ss, l); };
    var c1 = c(0, s * 0.2, 25 + a * 0.3), c2 = c(0, s, 45 + a), c3 = c(0, s, 55 + a), c4 = c(0, s, 65 + a);
    var c5 = c(0, s, 80 + a * 0.4), c6 = c(0, s, 91 + a * 0.1), c7 = c(0, s, 95), c8 = c(0, s, 97);
    var d = o.delta || [0, 0, 0];
    var out = {
        accent: c3, accentText: c2, accentSoft: c6, onAccent: "#FFFFFF",
        shell: c7, sidebar: "#FEFEFE", panel: c(0, s * 0.8, 91),
        surface: "#FFFFFFE2", surfaceRaised: "#FFFFFF", surfaceSunken: c7, menu: "#FFFFFF",
        toolbar: c8, docSurface: "#FFFFFF",
        textPrimary: "#404040", textSecondary: "#737373", textMuted: "#8C8C8C", textFaint: "#A6A6A6",
        outline: color.alpha(c5, 140), outlineSoft: color.alpha(c5, 110), panelOutline: color.alpha(c5, 150),
        groupOutline: color.alpha(c5, 120), divider: color.alpha(c5, 110),
        rowHover: color.alpha(c6, 170), navHover: color.alpha(c6, 200), hover: color.alpha(c6, 150),
        hoverStrong: color.alpha(c5, 170), selection: color.alpha(c4, 90),
        titleText: "#FFFFFF", titleMuted: "#FFFFFF", titleActive: c2,
        primaryText: c2, buttonOutline: "#333335", shellOutline: "#00000001", "$c2": c2,
        "$bg0": c(-15, s * 0.8, 91), "$bg1": c(0, s * 0.8, 91), "$bg2": c(15, s * 0.8, 91),
        "$c1": c1
    };
    if (o.rainbow) {
        out["$t0"] = c(-21, s, 53 + a); out["$t1"] = c(-7, s, 47 + a);
        out["$t2"] = c(7, s, 47 + a); out["$t3"] = c(21, s, 53 + a);
    } else if (o.titleAbs) {
        var t = o.titleAbs;
        out["$t0"] = c(0, s, t[0]); out["$t1"] = c(0, s, t[1]); out["$t2"] = c(0, s, t[2]); out["$t3"] = c(0, s, t[0]);
    } else {
        out["$t0"] = c(d[0], s, 48 + a); out["$t1"] = c(d[1], s, 54 + a);
        out["$t2"] = c(d[2], s, 48 + a); out["$t3"] = out["$t0"];
    }
    return out;
}
