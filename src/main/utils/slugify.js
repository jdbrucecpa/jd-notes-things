/**
 * Convert a title to a URL/filesystem-friendly slug.
 *
 * Shared by RoutingEngine (folder slug) and the meeting export (file slug)
 * so folder and file names always agree.
 *
 * Rules: lowercase -> drop apostrophes/periods (J.D. -> jd, O'Brien -> obrien)
 * -> collapse every other non-alphanumeric run to a single dash -> trim edge
 * dashes -> cap at 80 chars (vault lives on a Windows share; the slug appears
 * in both the folder AND the file name, so unbounded slugs risk MAX_PATH).
 * Falsy input, or any input that reduces to empty, yields 'meeting'.
 *
 * @param {string} title
 * @returns {string}
 */
const MAX_SLUG_LENGTH = 80;

function slugify(title) {
  const slug = String(title || 'meeting')
    .toLowerCase()
    .replace(/['’.]/g, '') // J.D. -> jd, O'Brien -> obrien (straight + curly apostrophe)
    .replace(/[^a-z0-9]+/g, '-') // collapse everything else to dashes
    .replace(/^-+|-+$/g, '') // trim edge dashes
    .substring(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, ''); // no trailing dash after the cut
  return slug || 'meeting';
}

module.exports = slugify;
