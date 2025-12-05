/**
 * Company Page Template Generator (CS-3)
 * Generates Obsidian-compatible markdown pages for companies
 */

/**
 * Generate a company page
 * @param {Object} company - Company data
 * @param {Object} options - Additional options
 * @returns {string} Markdown content for the company page
 */
function generateCompanyPage(company, options = {}) {
  const {
    name = company.name || 'Unknown Company',
    domain = company.domain || '',
    industry = company.industry || '',
    website = company.website || '',
    contacts = company.contacts || [],
    routingFolder = company.routingFolder || '',
    description = company.description || '',
    additionalTags = [],
  } = options;

  // Generate frontmatter
  const frontmatter = {
    type: 'company',
    name: name,
    aliases: generateCompanyAliases(name),
    domain: domain || null,
    industry: industry || null,
    website: website || (domain ? `https://${domain}` : null),
    contacts: contacts.length > 0 ? contacts.map(c => `"[[${c}]]"`) : null,
    routing_folder: routingFolder || null,
    tags: ['company', ...additionalTags],
    created: new Date().toISOString().split('T')[0],
  };

  // Build frontmatter YAML
  const frontmatterYaml = buildFrontmatter(frontmatter);

  // Build body content
  const body = buildCompanyBody(name, {
    domain,
    industry,
    website,
    contacts,
    description,
  });

  return `${frontmatterYaml}\n${body}`;
}

/**
 * Generate company name aliases
 * @param {string} companyName - The company name
 * @returns {Array<string>} List of aliases
 */
function generateCompanyAliases(companyName) {
  const aliases = [];

  // Remove common suffixes for alias
  const suffixes = [' Inc.', ' Inc', ' Corp.', ' Corp', ' LLC', ' Ltd.', ' Ltd', ' Co.', ' Co'];
  let shortName = companyName;

  for (const suffix of suffixes) {
    if (shortName.endsWith(suffix)) {
      shortName = shortName.slice(0, -suffix.length).trim();
      break;
    }
  }

  if (shortName !== companyName) {
    aliases.push(shortName);
  }

  // Add acronym if name has multiple words
  const words = companyName.split(' ').filter(w => w && !['Inc', 'Inc.', 'Corp', 'Corp.', 'LLC', 'Ltd', 'Ltd.', 'Co', 'Co.', 'The'].includes(w));
  if (words.length >= 2) {
    const acronym = words.map(w => w[0]).join('').toUpperCase();
    if (acronym.length >= 2 && acronym.length <= 5) {
      aliases.push(acronym);
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
 * Build the body content for a company page
 * @param {string} name - Company name
 * @param {Object} data - Company data
 * @returns {string} Markdown body content
 */
function buildCompanyBody(name, data) {
  const lines = [];

  // Title
  lines.push(`# ${name}`);
  lines.push('');

  // Description or industry
  if (data.description) {
    lines.push(data.description);
    lines.push('');
  } else if (data.industry) {
    lines.push(`${data.industry} company.`);
    lines.push('');
  }

  // Company Info section
  lines.push('## Company Info');
  lines.push('');

  if (data.website) {
    lines.push(`- **Website:** [${data.website}](${data.website})`);
  } else if (data.domain) {
    lines.push(`- **Website:** [https://${data.domain}](https://${data.domain})`);
  }

  if (data.domain) {
    lines.push(`- **Domain:** ${data.domain}`);
  }

  if (data.industry) {
    lines.push(`- **Industry:** ${data.industry}`);
  }

  lines.push('');

  // Key Contacts section
  lines.push('## Key Contacts');
  lines.push('');

  if (data.contacts && data.contacts.length > 0) {
    for (const contact of data.contacts) {
      lines.push(`- [[${contact}]]`);
    }
  } else {
    lines.push('<!-- Add contacts as wiki-links, e.g., [[John Smith]] -->');
  }

  lines.push('');

  // Notes section
  lines.push('## Notes');
  lines.push('');
  lines.push('<!-- Add notes about this company here -->');
  lines.push('');

  // Recent Meetings section
  lines.push('## Recent Meetings');
  lines.push('');
  lines.push('<!-- Backlinks will automatically show all meetings mentioning this company -->');
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate safe filename from company name
 * @param {string} name - Company name
 * @returns {string} Safe filename (without extension)
 */
function generateCompanyFilename(name) {
  if (!name) return 'Unknown Company';

  // Replace invalid filename characters
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract company name from email domain
 * @param {string} domain - Email domain (e.g., "acme.com")
 * @returns {string} Company name guess
 */
function guessCompanyNameFromDomain(domain) {
  if (!domain) return '';

  // Remove common TLDs
  let name = domain.split('.')[0];

  // Capitalize first letter
  name = name.charAt(0).toUpperCase() + name.slice(1);

  return name;
}

module.exports = {
  generateCompanyPage,
  generateCompanyFilename,
  generateCompanyAliases,
  guessCompanyNameFromDomain,
};
