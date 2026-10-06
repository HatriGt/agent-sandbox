// Ported from web/src/components/memory/kinds.ts — order, labels and glyphs (Feather equivalents
// of the lucide set). Kinds are never coloured: amber stays reserved for "needs you".
import type { MemoryKind } from "@/lib/api";
import type { IconName } from "@/components/ui/Icon";

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
export const KIND_ICON: Record<MemoryKind, IconName> = {
  preference: "sliders",
  rule: "shield",
  domain: "compass",
  fact: "info",
  decision: "git-branch",
  lesson: "award",
  playbook: "book-open",
};
export const isOperatorKind = (k: MemoryKind) => k === "preference" || k === "rule";
