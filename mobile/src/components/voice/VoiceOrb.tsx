import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import { useReducedMotion } from "@/components/motion";

/**
 * The voice-mode sphere, cloud variant: a frosted white-blue globe with no hard edge. The disc is a
 * feathered radial gradient (white core → sky → transparent), and nine translucent cloud puffs in
 * three depth layers orbit inside it on their own periods, so the surface never repeats. The whole
 * cloud field slowly revolves; a specular highlight sits top-left; a haze halo breathes outside.
 *
 * Mic `level` (0..1) is spring-tracked and drives: globe scale, halo scale/opacity, cloud spread
 * (the puffs push outward and brighten when you speak) and the revolve speed. Silence falls back to
 * a 2.6s breath. Paused dims everything and freezes the orbits; reduce-motion keeps only a subtle
 * level-driven scale. Colours are intentionally fixed (not themed): this is the one place in the
 * app that is "sky", in light and dark alike. Every animated prop is a native-driver transform or
 * opacity; the SVG gradients are static.
 */

const SKY = {
  core: "#FFFFFF",
  mist: "#EAF4FF",
  sky: "#BFDCFF",
  azure: "#8CC2FF",
  deep: "#5DA6F5",
  lilac: "#C9C4FF",
  cyan: "#A8ECFF",
} as const;

interface Puff {
  id: string;
  // Rest position as a fraction of the radius, polar: angle (deg) + distance (0..1).
  angle: number;
  dist: number;
  // Puff radius as a fraction of the globe radius.
  r: number;
  tint: string;
  alpha: number;
  // Orbit period (ms) and sway amplitude (fraction of radius).
  period: number;
  sway: number;
  // Depth layer: 0 = back (big, faint, slow), 2 = front (small, bright, quick).
  layer: 0 | 1 | 2;
}

const PUFFS: Puff[] = [
  { id: "b1", angle: 200, dist: 0.3, r: 0.62, tint: SKY.azure, alpha: 0.55, period: 9800, sway: 0.1, layer: 0 },
  { id: "b2", angle: 40, dist: 0.35, r: 0.58, tint: SKY.deep, alpha: 0.42, period: 11400, sway: 0.09, layer: 0 },
  { id: "b3", angle: 310, dist: 0.25, r: 0.5, tint: SKY.lilac, alpha: 0.38, period: 12600, sway: 0.08, layer: 0 },
  { id: "m1", angle: 120, dist: 0.42, r: 0.4, tint: SKY.sky, alpha: 0.7, period: 7200, sway: 0.12, layer: 1 },
  { id: "m2", angle: 260, dist: 0.46, r: 0.36, tint: SKY.cyan, alpha: 0.6, period: 6400, sway: 0.13, layer: 1 },
  { id: "m3", angle: 10, dist: 0.5, r: 0.34, tint: SKY.azure, alpha: 0.55, period: 8100, sway: 0.11, layer: 1 },
  { id: "f1", angle: 160, dist: 0.3, r: 0.26, tint: SKY.core, alpha: 0.85, period: 4600, sway: 0.16, layer: 2 },
  { id: "f2", angle: 340, dist: 0.38, r: 0.22, tint: SKY.mist, alpha: 0.8, period: 5300, sway: 0.15, layer: 2 },
  { id: "f3", angle: 80, dist: 0.55, r: 0.2, tint: SKY.core, alpha: 0.7, period: 4100, sway: 0.17, layer: 2 },
];

const REVOLVE_MS = 26000;

function loopSine(v: Animated.Value, period: number, delay = 0) {
  return Animated.loop(
    Animated.sequence([
      Animated.delay(delay),
      Animated.timing(v, { toValue: 1, duration: period / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: period / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]),
  );
}

export function VoiceOrb({ level, paused, size = 220 }: { level: number; paused: boolean; size?: number }) {
  const reduced = useReducedMotion();
  const lvl = useRef(new Animated.Value(0)).current;
  const breath = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const dim = useRef(new Animated.Value(1)).current;
  const sways = useRef(PUFFS.map(() => new Animated.Value(0))).current;
  const sways2 = useRef(PUFFS.map(() => new Animated.Value(0))).current;

  // Spring-track the raw level: bursts land soft, silence decays rather than snapping.
  useEffect(() => {
    Animated.spring(lvl, { toValue: paused ? 0 : level, speed: 18, bounciness: 3, useNativeDriver: true }).start();
  }, [level, paused, lvl]);

  useEffect(() => {
    Animated.timing(dim, { toValue: paused ? 0.5 : 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [paused, dim]);

  // Breath, revolve and per-puff sway loops. Frozen (and settled) while paused or under reduce-motion.
  useEffect(() => {
    if (paused || reduced) {
      [breath, spin, ...sways, ...sways2].forEach((v) => v.stopAnimation());
      Animated.timing(breath, { toValue: 0, duration: 260, useNativeDriver: true }).start();
      return;
    }
    const loops = [
      loopSine(breath, 2600),
      Animated.loop(Animated.timing(spin, { toValue: 1, duration: REVOLVE_MS, easing: Easing.linear, useNativeDriver: true })),
      ...PUFFS.map((p, i) => loopSine(sways[i], p.period, (i * 377) % 1500)),
      ...PUFFS.map((p, i) => loopSine(sways2[i], p.period * 1.37, (i * 541) % 2100)),
    ];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [paused, reduced, breath, spin, sways, sways2]);

  const r = size / 2;
  const box = Math.round(size * 1.7);
  const c = box / 2;

  const globeScale = reduced
    ? lvl.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] })
    : Animated.add(lvl.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] }), breath.interpolate({ inputRange: [0, 1], outputRange: [0, 0.025] }));
  const haloScale = Animated.add(lvl.interpolate({ inputRange: [0, 1], outputRange: [1, reduced ? 1.06 : 1.3] }), breath.interpolate({ inputRange: [0, 1], outputRange: [0, 0.04] }));
  const haloOpacity = Animated.multiply(lvl.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }), dim);
  // Speaking pushes the clouds outward (spread) and brightens the front layer.
  const spread = lvl.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] });
  const frontGlow = Animated.multiply(lvl.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] }), dim);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const counterRotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-360deg"] });

  // Layer rotation: the back layer revolves with the field, the front counter-rotates at a slower
  // rate so parallax reads as depth rather than a spinning disc.
  const layerRotate = useMemo(
    () => [rotate, spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "140deg"] }), counterRotate] as const,
    [rotate, counterRotate, spin],
  );

  return (
    <View style={{ width: box, height: box, alignItems: "center", justifyContent: "center" }} pointerEvents="none">
      {/* Haze halo: a wide feathered disc that swells with the voice. */}
      <Animated.View style={{ position: "absolute", width: box, height: box, opacity: haloOpacity, transform: [{ scale: haloScale }] }}>
        <Svg width={box} height={box}>
          <Defs>
            <RadialGradient id="halo" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0%" stopColor={SKY.sky} stopOpacity={0.45} />
              <Stop offset="55%" stopColor={SKY.azure} stopOpacity={0.16} />
              <Stop offset="100%" stopColor={SKY.deep} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={c} cy={c} r={c} fill="url(#halo)" />
        </Svg>
      </Animated.View>

      {/* Globe: feathered base (no clip, no rim) + three revolving cloud layers + specular. */}
      <Animated.View style={{ width: size, height: size, opacity: dim, transform: [{ scale: globeScale }] }}>
        <Svg width={size} height={size} style={{ position: "absolute" }}>
          <Defs>
            <RadialGradient id="globe" cx="46%" cy="44%" rx="56%" ry="56%">
              <Stop offset="0%" stopColor={SKY.core} stopOpacity={1} />
              <Stop offset="42%" stopColor={SKY.mist} stopOpacity={0.98} />
              <Stop offset="74%" stopColor={SKY.sky} stopOpacity={0.9} />
              <Stop offset="92%" stopColor={SKY.azure} stopOpacity={0.45} />
              <Stop offset="100%" stopColor={SKY.deep} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={r} cy={r} r={r} fill="url(#globe)" />
        </Svg>

        {([0, 1, 2] as const).map((layer) => (
          <Animated.View
            key={layer}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: size,
              height: size,
              opacity: layer === 2 ? frontGlow : 1,
              transform: [{ rotate: layerRotate[layer] }, { scale: layer === 0 ? 1 : spread }],
            }}
          >
            {PUFFS.filter((p) => p.layer === layer).map((p) => {
              const i = PUFFS.indexOf(p);
              const d = r * p.r;
              const a = (p.angle * Math.PI) / 180;
              const cx = r + Math.cos(a) * p.dist * r;
              const cy = r + Math.sin(a) * p.dist * r;
              const amp = p.sway * r;
              const dx = sways[i].interpolate({ inputRange: [0, 1], outputRange: [-amp, amp] });
              const dy = sways2[i].interpolate({ inputRange: [0, 1], outputRange: [amp * 0.7, -amp * 0.7] });
              const puffScale = sways2[i].interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.08] });
              return (
                <Animated.View
                  key={p.id}
                  style={{ position: "absolute", left: cx - d, top: cy - d, width: d * 2, height: d * 2, transform: [{ translateX: dx }, { translateY: dy }, { scale: puffScale }] }}
                >
                  <Svg width={d * 2} height={d * 2}>
                    <Defs>
                      <RadialGradient id={`puff-${p.id}`} cx="50%" cy="50%" rx="50%" ry="50%">
                        <Stop offset="0%" stopColor={p.tint} stopOpacity={p.alpha} />
                        <Stop offset="45%" stopColor={p.tint} stopOpacity={p.alpha * 0.55} />
                        <Stop offset="100%" stopColor={p.tint} stopOpacity={0} />
                      </RadialGradient>
                    </Defs>
                    <Circle cx={d} cy={d} r={d} fill={`url(#puff-${p.id})`} />
                  </Svg>
                </Animated.View>
              );
            })}
          </Animated.View>
        ))}

        {/* Specular: a soft off-centre highlight that keeps the globe reading as a sphere. */}
        <Svg width={size} height={size} style={{ position: "absolute" }}>
          <Defs>
            <RadialGradient id="spec" cx="34%" cy="28%" rx="34%" ry="30%">
              <Stop offset="0%" stopColor={SKY.core} stopOpacity={0.9} />
              <Stop offset="100%" stopColor={SKY.core} stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="feather" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0%" stopColor={SKY.core} stopOpacity={0} />
              <Stop offset="82%" stopColor={SKY.core} stopOpacity={0} />
              <Stop offset="100%" stopColor={SKY.sky} stopOpacity={0.35} />
            </RadialGradient>
          </Defs>
          <Circle cx={r} cy={r} r={r} fill="url(#spec)" />
          <Circle cx={r} cy={r} r={r} fill="url(#feather)" />
        </Svg>
      </Animated.View>
    </View>
  );
}
