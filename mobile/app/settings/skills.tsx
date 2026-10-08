// Skills route: the library body lives in src/components/skills so Harnesses can embed it too.
import React from "react";
import { SettingsScreen } from "@/components/SettingsScreen";
import { SkillsBody } from "@/components/skills/SkillsBody";

export default function Skills() {
  return (
    <SettingsScreen title="Skills">
      <SkillsBody />
    </SettingsScreen>
  );
}
