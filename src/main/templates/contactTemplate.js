/**
 * Contact Page Template Generator (CS-3)
 * Generates Obsidian-compatible markdown pages for contacts
 */

/**
 * Generate a contact page from Google Contact data
 * @param {Object} contact - Contact data from Google Contacts
 * @param {Object} options - Additional options
 * @returns {string} Markdown content for the contact page
 */
function generateContactPage(contact, options = {}) {
  const {
    name = contact.name || 'Unknown Contact',
    emails = contact.emails || [],
    phones = contact.phones || [],
    organization = contact.organization || '',
    title = contact.title || '',
    photoUrl = contact.photoUrl || '',
    resourceName = contact.resourceName || '',
    linkedCompany = null,
    additionalTags = [],
  } = options;

  // Generate frontmatter
  const frontmatter = {
    type: 'person',
    name: name,
    aliases: generateAliases(name),
    emails: emails,
    company: linkedCompany ? `"[[${linkedCompany}]]"` : organization || null,
    role: title || null,
    phones: phones.length > 0 ? phones : null,
    google_contact_id: resourceName || null,
    photo_url: photoUrl || null,
    tags: ['contact', ...additionalTags],
    created: new Date().toISOString().split('T')[0],
  };

  // Build frontmatter YAML
  const frontmatterYaml = buildFrontmatter(frontmatter);

  // Build body content
  const body = buildContactBody(name, {
    emails,
    phones,
    organization,
    title,
    linkedCompany,
    resourceName,
  });

  return `${frontmatterYaml}\n${body}`;
}

/**
 * Generate name aliases for the contact
 * @param {string} fullName - The full name
 * @returns {Array<string>} List of aliases
 */
function generateAliases(fullName) {
  const aliases = [];
  const parts = fullName.split(' ').filter(p => p);

  if (parts.length >= 2) {
    // First name only
    aliases.push(parts[0]);

    // Last name only
    aliases.push(parts[parts.length - 1]);

    // First initial + Last name (e.g., "J. Smith")
    aliases.push(`${parts[0][0]}. ${parts[parts.length - 1]}`);

    // Initials (e.g., "JS")
    if (parts.length === 2) {
      aliases.push(`${parts[0][0]}${parts[1][0]}`);
    }
  }

  return aliases;
}

/**
 * Build YAML frontmatter string
 * @param {Object} data - Frontmatter data
 * @returns {string} YAML frontmatter
 */
function buildFrontmatter(data) {
  const lines = ['---'];

  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;

    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${formatYamlValue(item)}`);
      }
    } else {
      lines.push(`${key}: ${formatYamlValue(value)}`);
    }
  }

  lines.push('---');
  return lines.join('\n');
}

/**
 * Format a value for YAML
 * @param {*} value - Value to format
 * @returns {string} Formatted value
 */
function formatYamlValue(value) {
  if (typeof value === 'string') {
    // Check if it's already a wiki-link (starts with "[[")
    if (value.startsWith('"[[')) {
      return value;
    }
    // Quote strings that contain special characters
    if (value.includes(':') || value.includes('#') || value.includes('[')) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return `"${value}"`;
  }
  return String(value);
}

/**
 * Build the body content for a contact page
 * @param {string} name - Contact name
 * @param {Object} data - Contact data
 * @returns {string} Markdown body content
 */
function buildContactBody(name, data) {
  const lines = [];

  // Title
  lines.push(`# ${name}`);
  lines.push('');

  // Subtitle with role and company
  if (data.title || data.linkedCompany || data.organization) {
    const roleCompany = [];
    if (data.title) roleCompany.push(data.title);
    if (data.linkedCompany) {
      roleCompany.push(`at [[${data.linkedCompany}]]`);
    } else if (data.organization) {
      roleCompany.push(`at ${data.organization}`);
    }
    if (roleCompany.length > 0) {
      lines.push(roleCompany.join(' '));
      lines.push('');
    }
  }

  // Contact Info section
  lines.push('## Contact Info');
  lines.push('');

  if (data.emails.length > 0) {
    lines.push(`- **Email:** ${data.emails[0]}`);
    for (let i = 1; i < data.emails.length; i++) {
      lines.push(`- **Email (alt):** ${data.emails[i]}`);
    }
  }

  if (data.phones.length > 0) {
    for (const phone of data.phones) {
      lines.push(`- **Phone:** ${phone}`);
    }
  }

  if (data.resourceName) {
    const googleUrl = `https://contacts.google.com/${data.resourceName}`;
    lines.push(`- **Google Contacts:** [View in Google](${googleUrl})`);
  }

  lines.push('');

  // Notes section
  lines.push('## Notes');
  lines.push('');
  lines.push('<!-- Add notes about this person here -->');
  lines.push('');

  // Recent Meetings section
  lines.push('## Recent Meetings');
  lines.push('');
  lines.push('<!-- Backlinks will automatically show all meetings where this contact appears -->');
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate safe filename from contact name
 * @param {string} name - Contact name
 * @returns {string} Safe filename (without extension)
 */
function generateContactFilename(name) {
  if (!name) return 'Unknown Contact';

  // Replace invalid filename characters
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  generateContactPage,
  generateContactFilename,
  generateAliases,
};
