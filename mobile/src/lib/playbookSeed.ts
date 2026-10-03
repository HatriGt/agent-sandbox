// One-shot hand-off of a starter YAML from the Playbooks list to /playbook/new (too long for a URL param).
let seed: string | null = null;
export function setPlaybookSeed(yaml: string) {
  seed = yaml;
}
export function takePlaybookSeed(): string | null {
  const s = seed;
  seed = null;
  return s;
}
