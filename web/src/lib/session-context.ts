import * as React from "react";

/** The sandbox a subtree belongs to — so leaf items (attachment thumbnails) can fetch artifacts. */
export const SessionContext = React.createContext<string | null>(null);
export const useSession = () => React.useContext(SessionContext);

/**
 * The repositories checked out in that sandbox (dir name + branch, as the fleet reports them) — so a
 * leaf item can act "for this repo" (the Resolve row's "Save for this repo") without a prop chain.
 */
export const SessionReposContext = React.createContext<readonly { name: string; branch?: string }[]>([]);

/** Where composer attachments live inside the box; the agent opens them with its Read tool. */
export const ATTACHMENTS_DIR = ".attachments";
/** A picture attached to a message, by its in-box path. */
export const ATTACHMENT_RE = /\/workspace\/\.attachments\/[\w.-]+\.(?:png|jpe?g|gif|webp)/gi;
/** Any attachment (a picture, a PDF, a document, a pasted passage), by its in-box path. */
export const ANY_ATTACHMENT_RE = /\/workspace\/\.attachments\/[\w-]+(?:\.[\w-]+)*/g;
