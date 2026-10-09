import React, { useEffect, useMemo } from "react";
import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { Easing, useDerivedValue, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { useReducedMotion } from "@/components/motion";

/**
 * The voice-mode orb: a single fragment shader, so the surface rolls like a volumetric cloud rather
 * than layered circles. Two domain-warp passes feed a 4-octave value-noise fbm over polar-ish
 * coordinates; the fbm value picks a point on a 4-stop blue palette, a specular lobe sits top-left,
 * a darker rim hugs the feathered edge, and a wide haze glows outside. The mic `level` (0..1) is
 * spring-smoothed on the UI thread and only ever reaches the GPU as a uniform: it speeds up the
 * cloud, grows the radius and brightens the haze. Paused: time slows to 0.15x and colour drifts
 * toward grey. Reduce-motion: time at 0.03x and no level-driven radius. Everything per-frame runs in
 * the shader — no JS allocations once mounted.
 */

const SKSL = `
uniform float u_time;
uniform float u_level;
uniform float2 u_center;
uniform float u_radius;
uniform float u_paused;
uniform float u_reduced;

// Smooth gradient noise (quintic fade) — no grain, large soft features.
float2 hash2(float2 p) {
  p = float2(dot(p, float2(127.1, 311.7)), dot(p, float2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float gnoise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(
    mix(dot(hash2(i + float2(0.0, 0.0)), f - float2(0.0, 0.0)), dot(hash2(i + float2(1.0, 0.0)), f - float2(1.0, 0.0)), u.x),
    mix(dot(hash2(i + float2(0.0, 1.0)), f - float2(0.0, 1.0)), dot(hash2(i + float2(1.0, 1.0)), f - float2(1.0, 1.0)), u.x),
    u.y);
}

float fbm(float2 p) {
  float v = 0.0;
  float amp = 0.55;
  float2x2 rot = float2x2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 3; i++) {
    v += amp * gnoise(p);
    p = rot * p * 1.9 + 7.3;
    amp *= 0.5;
  }
  return v;
}

half4 main(float2 xy) {
  // Sphere-normalised coordinates: the sphere has radius 0.40 regardless of where it sits on screen.
  float2 uv = (xy - u_center) / u_radius * 0.40;
  float dist = length(uv);
  float t = u_time;

  float radius = 0.40 + u_level * 0.03 * (1.0 - u_reduced);
  // Crisp anti-aliased disc: the orb IS a sphere; the clouds live inside it.
  float px = 0.40 / u_radius;
  float mask = 1.0 - smoothstep(radius - px, radius + px, dist);

  // Sphere coordinates: fake z and normal, so wisps wrap around the ball instead of lying flat.
  float2 s = uv / radius;
  float z = sqrt(max(0.0, 1.0 - dot(s, s)));
  float3 nrm = float3(s, z);

  // Slow global swirl plus two low-frequency warp passes: big soft cloud masses, slowly rolling.
  float ca = cos(t * 0.35), sa = sin(t * 0.35);
  float2 d = float2x2(ca, -sa, sa, ca) * s;
  float2 p = d * 1.35 + float2(0.0, z * 0.6);
  float2 q = float2(fbm(p + float2(0.0, t * 0.6)), fbm(p + float2(3.1, 1.7) - t * 0.45));
  float2 w = float2(fbm(p + 1.6 * q + float2(1.7, 9.2) + t * 0.3), fbm(p + 1.6 * q + float2(8.3, 2.8) - t * 0.25));
  float n = fbm(p + 1.4 * w + t * 0.15);          // ~ -0.6 .. 0.6
  float n2 = fbm(p * 0.7 - 1.1 * q + float2(4.0, 6.0) - t * 0.2);

  // Base: a lit blue sphere. Light from top-left, soft fresnel toward the limb.
  float3 L = normalize(float3(-0.45, -0.55, 0.7));
  float diff = clamp(dot(nrm, L), 0.0, 1.0);
  float fres = pow(1.0 - z, 2.2);
  half3 deep  = half3(0.16, 0.40, 0.86);   // #2966DB
  half3 azure = half3(0.36, 0.64, 1.0);    // #5CA3FF
  half3 sky   = half3(0.66, 0.83, 1.0);    // #A8D4FF
  half3 white = half3(0.96, 0.98, 1.0);
  half3 base = mix(deep, azure, diff * 0.85 + 0.1);
  base = mix(base, sky, fres * 0.75);

  // Clouds: broad white masses where the warped noise rises, with a denser bright core, and
  // deeper blue troughs in between. Speaking lifts the cloud threshold so more white blooms.
  float cloud = smoothstep(-0.08 - u_level * 0.08, 0.3, n);
  float core = smoothstep(0.12, 0.42, n + 0.3 * n2);
  float trough = smoothstep(0.0, -0.35, n2);
  half3 inside = mix(base, deep, trough * 0.5);
  inside = mix(inside, mix(sky, white, 0.6), cloud * 0.9);
  inside = mix(inside, white, core * 0.9);

  // Specular lobe, and a bright limb so the ball reads glossy and round.
  float3 H = normalize(L + float3(0.0, 0.0, 1.0));
  float spec = pow(clamp(dot(nrm, H), 0.0, 1.0), 48.0);
  inside += half3(spec * 0.35);
  inside = mix(inside, white, pow(fres, 1.6) * 0.35);

  // Reflector glow: a wide exponential falloff from the limb, like light bleeding through haze.
  // Two terms - a tight bright corona and a long soft tail - so it reads as one continuous
  // light source rather than a ring. Breathes outward with the voice.
  float dOut = max(0.0, dist - radius);
  float corona = exp(-dOut * (14.0 - u_level * 4.0));
  float tail = exp(-dOut * (4.0 - u_level * 1.2));
  float haze = (corona * 0.5 + tail * 0.5) * (0.42 + u_level * 0.5) * (1.0 - mask);
  // A slow drift in the glow's colour so the reflector feels alive, never a static ring.
  half3 hazeCol = mix(azure, sky, 0.5 + 0.5 * n);

  // Premultiplied output: the colour is already weighted by its coverage, so alpha is applied
  // exactly once. Multiplying again would square the faint tail and cut the glow off short.
  half3 col = inside * mask + hazeCol * haze;
  float alpha = clamp(mask + haze, 0.0, 1.0);

  float lum = dot(col, half3(0.299, 0.587, 0.114));
  col = mix(col, half3(lum), u_paused * 0.7);
  return half4(col, alpha);
}
`;

const compiled = Skia.RuntimeEffect.Make(SKSL);
if (!compiled) throw new Error("VoiceOrb: shader failed to compile");
const effect = compiled;

/**
 * Renders full-bleed: the Canvas fills the overlay and the sphere is placed at `center` (window
 * px) with `size` diameter, so the glow can bleed across the whole screen and never meets a box
 * edge. Mount it absolutely behind the UI; pass the orb's measured centre.
 */
export function VoiceOrb({
  level,
  paused,
  size = 200,
  center,
  viewport,
}: {
  level: SharedValue<number>;
  paused: boolean;
  size?: number;
  center: { x: number; y: number };
  viewport: { width: number; height: number };
}) {
  const reduced = useReducedMotion();
  const clock = useClock();
  const pausedV = useSharedValue(paused ? 1 : 0);
  // Smoothed level, accumulated phase and last clock live on the UI thread; nothing per-frame
  // crosses the bridge. Phase integrates dt * speed so a louder moment accelerates the clouds
  // instead of teleporting them (t = time * speed would jump every time speed changed).
  const lvl = useSharedValue(0);
  const phase = useSharedValue(0);
  const last = useSharedValue(0);

  useEffect(() => {
    pausedV.value = withTiming(paused ? 1 : 0, { duration: 320, easing: Easing.out(Easing.cubic) });
  }, [paused, pausedV]);

  const centerU = useMemo(() => [center.x, center.y], [center.x, center.y]);
  const radiusPx = size / 2;
  const reducedV = reduced ? 1 : 0;
  const uniforms = useDerivedValue(() => {
    const now = clock.value / 1000;
    const dt = last.value === 0 ? 0 : Math.min(0.05, now - last.value);
    last.value = now;
    // Asymmetric smoothing: attack fast (voice onsets feel immediate), release slow (no flutter).
    const target = level.value;
    const k = target > lvl.value ? 1 - Math.exp(-dt * 18) : 1 - Math.exp(-dt * 5);
    lvl.value = lvl.value + (target - lvl.value) * k;
    const speed = (0.22 + lvl.value * 0.45) * (1 - pausedV.value * 0.85) * (reducedV ? 0.15 : 1);
    phase.value = phase.value + dt * speed;
    return {
      u_time: phase.value,
      u_level: lvl.value,
      u_center: centerU,
      u_radius: radiusPx,
      u_paused: pausedV.value,
      u_reduced: reducedV,
    };
  }, [centerU, radiusPx, reducedV]);

  return (
    <Canvas pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width: viewport.width, height: viewport.height }}>
      <Fill>
        <Shader source={effect} uniforms={uniforms} />
      </Fill>
    </Canvas>
  );
}
