import * as React from "react";

/** The sandbox a subtree belongs to — so leaf items (attachment thumbnails) can fetch artifacts. */
export const SessionContext = React.createContext<string | null>(null);
export const useSession = () => React.useContext(SessionContext);

/** Where composer image attachments live inside the box; the agent opens them with its Read tool. */
export const ATTACHMENTS_DIR = ".attachments";
export const ATTACHMENT_RE = /\/workspace\/\.attachments\/[\w.-]+\.(?:png|jpe?g|gif|webp)/gi;
