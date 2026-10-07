/**
 * The largest file a pane takes as an attachment. The browser checks a file against it before
 * reading or sending any of it, and POST /api/pane/image refuses what is over it. It dates from
 * pasted screenshots (0.1-2 MB each, so 8 MB left headroom); raising it is not only this
 * number, since the upload is one JSON body the server holds whole.
 */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
