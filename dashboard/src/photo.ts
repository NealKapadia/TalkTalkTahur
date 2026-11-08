/** Split a message body into its words and any "[Photo: description]" tags the hub added. */
export function splitPhotos(body: string): { text: string; photos: string[] } {
  const photos: string[] = [];
  const text = body.replace(/\[Photo(?::\s*([^\]]*))?\]/g, (_m, d: string | undefined) => { photos.push((d ?? '').trim()); return ''; }).replace(/\s+/g, ' ').trim();
  return { text, photos };
}
