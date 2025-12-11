/**
 * Dropdown Helper Utility
 *
 * Provides standardized functions for populating select dropdowns
 * and creating dropdown options consistently across the renderer.
 *
 * v1.2 Tech Debt Refactoring
 */

/**
 * Populate a select element with options from an array of items
 *
 * @param {HTMLSelectElement} selectElement - The select element to populate
 * @param {Array} items - Array of items to create options from
 * @param {Object} options - Configuration options
 * @param {string} [options.defaultLabel] - Label for the default "All" option (e.g., "All Companies")
 * @param {string} [options.defaultValue=''] - Value for the default option
 * @param {string|Function} [options.valueKey='value'] - Key to extract value, or function(item) => value
 * @param {string|Function} [options.textKey='text'] - Key to extract text, or function(item) => text
 * @param {boolean} [options.preserveValue=true] - Preserve the current selection if possible
 * @param {boolean} [options.clearFirst=true] - Clear existing options before adding new ones
 *
 * @example
 * // Simple array of strings
 * populateSelect(companySelect, ['Acme Corp', 'BigCo'], {
 *   defaultLabel: 'All Companies'
 * });
 *
 * @example
 * // Array of objects with custom keys
 * populateSelect(contactSelect, contacts, {
 *   defaultLabel: 'All Contacts',
 *   valueKey: 'email',
 *   textKey: 'name'
 * });
 *
 * @example
 * // Using formatter functions
 * populateSelect(slugSelect, slugs, {
 *   defaultLabel: 'Select Client',
 *   valueKey: slug => slug,
 *   textKey: slug => slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
 * });
 */
export function populateSelect(selectElement, items, options = {}) {
  if (!selectElement) {
    console.warn('[DropdownHelper] Select element is null or undefined');
    return;
  }

  const {
    defaultLabel = null,
    defaultValue = '',
    valueKey = 'value',
    textKey = 'text',
    preserveValue = true,
    clearFirst = true,
  } = options;

  // Preserve current value if requested
  const currentValue = preserveValue ? selectElement.value : null;

  // Clear existing options if requested
  if (clearFirst) {
    selectElement.innerHTML = '';
  }

  // Add default option if specified
  if (defaultLabel !== null) {
    const defaultOption = document.createElement('option');
    defaultOption.value = defaultValue;
    defaultOption.textContent = defaultLabel;
    selectElement.appendChild(defaultOption);
  }

  // Add options for each item
  items.forEach(item => {
    const option = document.createElement('option');

    // Extract value
    if (typeof valueKey === 'function') {
      option.value = valueKey(item);
    } else if (typeof item === 'string') {
      option.value = item;
    } else {
      option.value = item[valueKey] ?? '';
    }

    // Extract text
    if (typeof textKey === 'function') {
      option.textContent = textKey(item);
    } else if (typeof item === 'string') {
      option.textContent = item;
    } else {
      option.textContent = item[textKey] ?? option.value;
    }

    selectElement.appendChild(option);
  });

  // Restore previous value if it still exists
  if (preserveValue && currentValue !== null) {
    // Check if the value exists in the new options
    const optionExists = Array.from(selectElement.options).some(opt => opt.value === currentValue);
    if (optionExists) {
      selectElement.value = currentValue;
    }
  }
}

/**
 * Add a separator option to a select element
 *
 * @param {HTMLSelectElement} selectElement - The select element
 * @param {string} [text='──────────'] - Separator text
 */
export function addSeparator(selectElement, text = '──────────') {
  if (!selectElement) return;

  const separator = document.createElement('option');
  separator.disabled = true;
  separator.textContent = text;
  selectElement.appendChild(separator);
}

/**
 * Add a single option to a select element
 *
 * @param {HTMLSelectElement} selectElement - The select element
 * @param {string} value - Option value
 * @param {string} text - Option display text
 * @param {Object} [attrs={}] - Additional attributes (disabled, selected, etc.)
 */
export function addOption(selectElement, value, text, attrs = {}) {
  if (!selectElement) return;

  const option = document.createElement('option');
  option.value = value;
  option.textContent = text;

  // Apply additional attributes
  Object.entries(attrs).forEach(([key, val]) => {
    if (typeof val === 'boolean') {
      option[key] = val;
    } else {
      option.setAttribute(key, val);
    }
  });

  selectElement.appendChild(option);
}

/**
 * Create a slug formatter function for display
 * Converts "my-company-name" to "My Company Name"
 *
 * @param {string} [suffix=''] - Optional suffix to append (e.g., " (vocabulary only)")
 * @returns {Function} Formatter function
 */
export function slugFormatter(suffix = '') {
  return slug => {
    const formatted = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    return suffix ? `${formatted}${suffix}` : formatted;
  };
}
