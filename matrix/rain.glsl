float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

vec4 effect(vec2 uv, vec2 pixel) {
    vec2 cell = vec2(14.0, 18.0);
    vec2 id = floor(pixel / cell);
    vec2 local = fract(pixel / cell);
    float rows = u_size.y / cell.y;
    float speed = 3.0 + hash(vec2(id.x, 7.0)) * 7.0;
    float head = mod(u_time * speed + hash(vec2(id.x, 3.0)) * 80.0, rows + 24.0);
    float dist = head - id.y;
    float trail = dist >= 0.0 ? exp(-dist * 0.16) : 0.0;
    float flicker = floor(u_time * (2.0 + 6.0 * hash(id + 1.7)));
    float glyph = floor(hash(id + flicker) * 16.0);
    vec2 atlas = (vec2(mod(glyph, 4.0), floor(glyph / 4.0)) + local) / 4.0;
    float ink = texture(u_texture0, atlas).r;
    vec3 green = mix(vec3(0.05, 0.85, 0.32), u_accent.rgb, 0.25);
    vec3 color = vec3(0.0, 0.025, 0.01) + green * ink * trail;
    color += vec3(0.75, 1.0, 0.8) * ink * (1.0 - step(0.6, abs(dist - 0.3)));
    return vec4(color, 1.0);
}
