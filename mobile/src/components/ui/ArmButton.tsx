import React, { useEffect, useRef, useState } from "react";
import { Button } from "./Button";

/**
 * Arm-to-confirm with 4s auto-disarm — the destructive-action pattern carried
 * over from the dashboard (never simplified to a system alert). First tap arms
 * the button and shows the exact consequence; second tap within 4s executes.
 */
export function ArmButton({
  title,
  armedTitle,
  onConfirm,
  small,
  variant = "outline",
  disabled,
}: {
  title: string;
  armedTitle: string;
  onConfirm: () => void | Promise<void>;
  small?: boolean;
  variant?: "outline" | "ghost" | "secondary";
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const press = async () => {
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), 4000);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setArmed(false);
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      title={armed ? armedTitle : title}
      onPress={press}
      variant={armed ? "destructive" : variant}
      small={small}
      loading={busy}
      disabled={disabled}
    />
  );
}
