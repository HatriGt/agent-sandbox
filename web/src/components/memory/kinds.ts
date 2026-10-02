import { BookOpen, Compass, Gavel, GraduationCap, Info, Scale, SlidersHorizontal, type LucideIcon } from "lucide-react";
import type { MemoryKind } from "@/lib/api";

/** Kind order everywhere on the page: operator kinds first, then what a repo learns, most actionable first. */
export const KINDS: MemoryKind[] = ["preference", "rule", "domain", "playbook", "lesson", "decision", "fact"];
export const KIND_LABEL: Record<MemoryKind, string> = {
  preference: "Preference",
  rule: "Rule",
  domain: "Domain",
  fact: "Fact",
  decision: "Decision",
  lesson: "Lesson",
  playbook: "Playbook",
};
export const KIND_PLURAL: Record<MemoryKind, string> = {
  preference: "Preferences",
  rule: "Rules",
  domain: "Domain knowledge",
  fact: "Facts",
  decision: "Decisions",
  lesson: "Lessons",
  playbook: "Playbooks",
};
export const KIND_ICON: Record<MemoryKind, LucideIcon> = {
  preference: SlidersHorizontal,
  rule: Gavel,
  domain: Compass,
  fact: Info,
  decision: Scale,
  lesson: GraduationCap,
  playbook: BookOpen,
};
/**
 * Kinds are told apart by glyph + label, and in the overview by an ink ramp (foreground at falling
 * opacity) — no hues, so amber stays reserved for "needs you" and both themes read the same.
 */
export const KIND_INK: Record<MemoryKind, number> = {
  preference: 0.9,
  rule: 0.7,
  domain: 0.62,
  playbook: 0.52,
  lesson: 0.42,
  decision: 0.3,
  fact: 0.2,
};
export const isOperatorKind = (k: MemoryKind) => k === "preference" || k === "rule";
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
