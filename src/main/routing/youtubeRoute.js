// src/main/routing/youtubeRoute.js
/**
 * YouTube content routing (spec §5). platform === 'youtube' meetings land in a
 * fixed `content/youtube/` folder under the vault root, a sibling mechanism to
 * the RoutingEngine `_unfiled` fallback. Returns a VAULT-RELATIVE fullPath so
 * exportMeetingToObsidian resolves it via vaultStructure.getAbsolutePath, exactly
 * like unfiled routes. Not user-configurable for now (YAGNI).
 */
const path = require('path');
const slugify = require('../utils/slugify');

const YOUTUBE_VAULT_DIR = path.join('content', 'youtube');

/**
 * @param {{title?:string, date?:string}} meeting
 * @returns {{type:string, slug:null, basePath:string, fullPath:string,
 *   folderName:string, dateStr:string, titleSlug:string, organizationName:string}}
 */
function buildYoutubeRoute(meeting) {
  const date = meeting && meeting.date ? new Date(meeting.date) : new Date();
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD (matches export file slug)
  const titleSlug = slugify(meeting && meeting.title);
  const folderName = `${dateStr}-${titleSlug}`;
  return {
    type: 'youtube',
    slug: null,
    basePath: YOUTUBE_VAULT_DIR,
    fullPath: path.join(YOUTUBE_VAULT_DIR, folderName),
    folderName,
    dateStr,
    titleSlug,
    organizationName: 'YouTube',
  };
}

module.exports = { buildYoutubeRoute, YOUTUBE_VAULT_DIR };
