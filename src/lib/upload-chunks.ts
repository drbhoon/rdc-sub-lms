/**
 * Course content is uploaded in pieces, not in one request.
 *
 * Every proxy between the browser and LMS caps a request body: the platform
 * nginx at 60 MB, IT's front nginx at an unknown size, and Next's own Server
 * Action limit at 100 MB. A training video is routinely bigger than the
 * smallest of those, and when one is exceeded the request never reaches LMS —
 * the browser just shows "This page couldn't load". Pieces of just under
 * 1 MB stay below nginx's default 1 MB cap, so they pass whatever any hop
 * is set to.
 *
 * Shared by the browser and the server, so it imports nothing from Node.
 */
export const UPLOAD_CHUNK_BYTES = 1_000_000;

const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUploadId(value: string) {
  return UPLOAD_ID.test(value);
}

/** Where a chunked upload is assembled until it is complete. */
export function incomingKey(uploadId: string) {
  return `incoming/${uploadId}.part`;
}
