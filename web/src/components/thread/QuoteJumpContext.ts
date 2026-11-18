import * as React from "react";
import type { QuoteRef } from "@/lib/quote-jump";

/**
 * Provided by Thread: scrolls the conversation to a quoted passage and flashes it. A quote pill in
 * a sent bubble (TraceItems YouItem) uses it the way the composer's pill does. Absent elsewhere.
 */
export const QuoteJumpContext = React.createContext<((quote: QuoteRef) => void) | null>(null);
