import React, { useEffect, useMemo } from "react";
import { Canvas, Fill, Shader, Skia } from "@shopify/react-native-skia";
import { useClock } from "@shopify/react-native-skia";
import { useDerivedValue, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
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
uniform float2 u_res;
uniform float u_paused;
uniform float u_reduced;

float hash(float2 p) {
  p = fract(p * float2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + float2(1.0, 0.0));
  float c = hash(i + float2(0.0, 1.0));
  float d = hash(i + float2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(float2 p) {
  float v = 0.0;
  float amp = 0.5;
  float2x2 rot = float2x2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += amp * vnoise(p);
    p = rot * p * 2.03 + 11.7;
    amp *= 0.5;
  }
  return v;
}

half4 main(float2 xy) {
  float2 uv = (xy - 0.5 * u_res) / min(u_res.x, u_res.y);
  float dist = length(uv);
  float ang = atan(uv.y, uv.x);
  float speed = (0.12 + u_level * 0.35) * mix(1.0, 0.15, u_paused) * mix(1.0, 0.03 / 0.12, u_reduced);
  float t = u_time * speed;

  // Polar-ish domain: angle wraps smoothly, radius stretched so the cloud rolls around the sphere.
  float2 pol = float2(cos(ang) * (0.6 + dist * 1.4), sin(ang) * (0.6 + dist * 1.4));
  float2 p = pol * 2.2;

  // Two warp passes.
  float2 q = float2(fbm(p + float2(0.0, t * 0.9)), fbm(p + float2(5.2, 1.3) - t * 0.7));
  float2 r = float2(fbm(p + 2.6 * q + float2(1.7, 9.2) + t * 0.5), fbm(p + 2.6 * q + float2(8.3, 2.8) - t * 0.4));
  float n = fbm(p + 2.2 * r + t * 0.25);

  float levelR = u_level * 0.04 * (1.0 - u_reduced);
  float radius = 0.42 + levelR + 0.02 * (n - 0.5) * 2.0;
  float mask = smoothstep(radius + 0.06, radius - 0.08, dist);

  // Four-stop blue palette by fbm value.
  half3 deep = half3(0.184, 0.435, 0.851);   // #2F6FD9
  half3 azure = half3(0.373, 0.659, 1.0);    // #5FA8FF
  half3 sky = half3(0.612, 0.796, 1.0);      // #9CCBFF
  half3 white = half3(0.902, 0.949, 1.0);    // #E6F2FF
  float k = clamp((n - 0.2) / 0.6, 0.0, 1.0);
  half3 inside = k < 0.333 ? mix(deep, azure, k * 3.0)
               : k < 0.666 ? mix(azure, sky, (k - 0.333) * 3.0)
               : mix(sky, white, (k - 0.666) * 3.0);

  // Soft specular lobe top-left, faint darker rim.
  float spec = exp(-dot(uv - float2(-0.16, -0.17), uv - float2(-0.16, -0.17)) * 28.0);
  inside += half3(spec * 0.35);
  float rim = smoothstep(radius - 0.14, radius, dist);
  inside = mix(inside, deep * 0.85, rim * 0.35);

  // Outside haze: same blues, alpha fading to 0 by 0.7, brighter with level.
  float haze = (1.0 - smoothstep(radius - 0.02, 0.7, dist)) * (1.0 - mask);
  haze = haze * haze * (0.28 + u_level * 0.4);
  half3 hazeCol = mix(azure, sky, 0.5 + 0.5 * (n - 0.5));

  half3 col = inside * mask + hazeCol * haze;
  float alpha = clamp(mask + haze, 0.0, 1.0);

  // Paused: drop saturation.
  float lum = dot(col, half3(0.299, 0.587, 0.114));
  col = mix(col, half3(lum), u_paused * 0.7);

  return half4(col * alpha, alpha);
}
`;

const compiled = Skia.RuntimeEffect.Make(SKSL);
if (!compiled) throw new Error("VoiceOrb: shader failed to compile");
const effect = compiled;

export function VoiceOrb({ level, paused, size = 200 }: { level: number; paused: boolean; size?: number }) {
  const reduced = useReducedMotion();
  const clock = useClock();
  const lvl = useSharedValue(0);
  const pausedV = useSharedValue(paused ? 1 : 0);

  useEffect(() => {
    lvl.value = withSpring(Math.max(0, Math.min(1, level)), { damping: 14, stiffness: 160, mass: 0.6 });
  }, [level, lvl]);
  useEffect(() => {
    pausedV.value = withTiming(paused ? 1 : 0, { duration: 260 });
  }, [paused, pausedV]);

  const res = useMemo(() => [size, size], [size]);
  const reducedV = reduced ? 1 : 0;
  const uniforms = useDerivedValue(
    () => ({
      u_time: clock.value / 1000,
      u_level: lvl.value,
      u_res: res,
      u_paused: pausedV.value,
      u_reduced: reducedV,
    }),
    [res, reducedV],
  );

  return (
    <Canvas style={{ width: size, height: size }}>
      <Fill>
        <Shader source={effect} uniforms={uniforms} />
      </Fill>
    </Canvas>
  );
}
