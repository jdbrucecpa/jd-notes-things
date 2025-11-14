/**
 * Security utilities for renderer process
 * Provides XSS protection through DOMPurify sanitization
 */

import DOMPurify from 'dompurify';
import { marked } from 'marked';

/**
 * Sanitize HTML content to prevent XSS attacks
 * @param {string} dirty - Untrusted HTML string
 * @param {object} options - DOMPurify configuration options
 * @returns {string} Sanitized HTML safe for insertion
 */
export function sanitizeHtml(dirty, options = {}) {
  const defaultConfig = {
    ALLOWED_TAGS: [
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'br',
      'hr',
      'ul',
      'ol',
      'li',
      'strong',
      'em',
      'code',
      'pre',
      'blockquote',
      'a',
      'span',
      'div',
      'button',
      'svg',
      'path',
      'circle',
      'rect',
      'line',
      'polyline',
      'polygon',
      'g',
    ],
    ALLOWED_ATTR: [
      'href',
      'title',
      'class',
      'id',
      'data-id',
      'data-tab',
      // SVG attributes
      'viewBox',
      'width',
      'height',
      'fill',
      'stroke',
      'stroke-width',
      'stroke-linecap',
      'stroke-linejoin',
      'd',
      'cx',
      'cy',
      'r',
      'x',
      'y',
      'x1',
      'y1',
      'x2',
      'y2',
      'points',
      'transform',
      'xmlns',
    ],
    ALLOW_DATA_ATTR: false,
    // Forbid attributes that execute scripts
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
    // Forbid tags that can execute scripts
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'base', 'link', 'meta'],
    // Keep links safe
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|obsidian):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  };

  const config = { ...defaultConfig, ...options };
  return DOMPurify.sanitize(dirty, config);
}

/**
 * Escape plain text to prevent HTML injection
 * Use when you want to display user input as plain text
 * @param {string} text - Plain text to escape
 * @returns {string} HTML-escaped text
 */
export function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Convert markdown to sanitized HTML
 * @param {string} markdown - Markdown text
 * @returns {string} Sanitized HTML
 */
export function markdownToSafeHtml(markdown) {
  if (!markdown) return '';

  // Convert markdown to HTML using marked library
  const rawHtml = marked.parse(markdown, {
    breaks: true,
    gfm: true,
  });

  // Sanitize the HTML output
  return sanitizeHtml(rawHtml);
}

/**
 * Safely set innerHTML with sanitization
 * @param {HTMLElement} element - Target element
 * @param {string} html - HTML content to set
 * @param {object} options - DOMPurify configuration options
 */
export function safeSetInnerHTML(element, html, options = {}) {
  if (!element) return;
  element.innerHTML = sanitizeHtml(html, options);
}

/**
 * Create a text node from user input (safest option)
 * @param {string} text - Text content
 * @returns {Text} Text node
 */
export function createSafeTextNode(text) {
  return document.createTextNode(text || '');
}
