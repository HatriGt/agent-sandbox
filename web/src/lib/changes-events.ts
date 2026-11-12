/**
 * The window event that says "a file's changes were discarded". It lives on its own so the
 * conversation's changes dock can listen for it without pulling the diff viewer (and with it the
 * code editor, 600 kB) into the first page load.
 */
export const CHANGES_DISCARDED_EVENT = "asb:changes-discarded";
