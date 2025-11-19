/**
 * Modal Dialog Helper Utility
 *
 * Provides a reusable function for creating modal dialogs with:
 * - XSS protection via DOMPurify
 * - Keyboard shortcuts (Escape to close, Enter to confirm)
 * - Click-outside-to-close behavior
 * - Support for different modal sizes
 * - Consistent styling and error handling
 *
 * Phase 10.9 Refactoring - Refactor #2
 */

import DOMPurify from 'dompurify';

/**
 * Creates and displays a modal dialog
 *
 * @param {Object} options - Modal configuration
 * @param {string} options.title - Modal title (plain text, will be escaped)
 * @param {string} options.body - Modal body HTML content (will be sanitized with DOMPurify)
 * @param {string} [options.confirmText='Confirm'] - Text for confirm button
 * @param {string} [options.cancelText='Cancel'] - Text for cancel button
 * @param {Function} [options.onConfirm] - Async function called when confirm button is clicked
 * @param {Function} [options.onCancel] - Optional function called when modal is cancelled
 * @param {string} [options.size='medium'] - Modal size: 'small', 'medium', or 'large'
 * @param {boolean} [options.showCancel=true] - Whether to show the cancel button
 *
 * @returns {void}
 *
 * @example
 * createModal({
 *   title: 'Delete Organization',
 *   body: '<p>Are you sure you want to delete this organization?</p>',
 *   confirmText: 'Delete',
 *   onConfirm: async () => await deleteOrg(orgId)
 * });
 */
export function createModal({
  title,
  body,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  size = 'medium',
  showCancel = true
}) {
  // Validate required parameters
  if (!title || typeof title !== 'string') {
    throw new Error('Modal title is required and must be a string');
  }
  if (!body || typeof body !== 'string') {
    throw new Error('Modal body is required and must be a string');
  }

  // Sanitize body HTML to prevent XSS attacks
  const sanitizedBody = DOMPurify.sanitize(body, {
    ALLOWED_TAGS: ['p', 'div', 'span', 'strong', 'em', 'br', 'ul', 'ol', 'li', 'code', 'pre', 'label', 'input', 'select', 'option', 'textarea', 'small'],
    ALLOWED_ATTR: ['class', 'style', 'id', 'for', 'type', 'placeholder', 'value', 'name']
  });

  // Escape title to prevent XSS (title is plain text, not HTML)
  const escapedTitle = escapeHtml(title);

  // Create modal overlay
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';

  // Add size class if specified
  let sizeClass = '';
  if (size === 'small' || size === 'large') {
    sizeClass = ` modal-${size}`;
  }

  // Build modal HTML structure
  modal.innerHTML = `
    <div class="modal-dialog${sizeClass}">
      <div class="modal-header">
        <h3>${escapedTitle}</h3>
        <button class="modal-close" data-modal-action="close" aria-label="Close modal">×</button>
      </div>
      <div class="modal-body">
        ${sanitizedBody}
      </div>
      <div class="modal-footer">
        ${showCancel ? `<button class="btn-secondary" data-modal-action="cancel">${escapeHtml(cancelText)}</button>` : ''}
        <button class="btn-primary" data-modal-action="confirm">${escapeHtml(confirmText)}</button>
      </div>
    </div>
  `;

  // Append modal to body
  document.body.appendChild(modal);

  // Get button elements
  const closeBtn = modal.querySelector('[data-modal-action="close"]');
  const cancelBtn = modal.querySelector('[data-modal-action="cancel"]');
  const confirmBtn = modal.querySelector('[data-modal-action="confirm"]');
  const _modalDialog = modal.querySelector('.modal-dialog'); // Reserved for future event handling

  // Track if modal is being closed (prevent duplicate closures)
  let isClosing = false;

  /**
   * Closes the modal and performs cleanup
   */
  const closeModal = () => {
    if (isClosing) return;
    isClosing = true;

    // Call onCancel callback if provided
    if (onCancel && typeof onCancel === 'function') {
      try {
        onCancel();
      } catch (error) {
        console.error('[ModalHelper] Error in onCancel callback:', error);
      }
    }

    // Remove modal from DOM
    if (modal.parentNode) {
      document.body.removeChild(modal);
    }

    // Remove event listeners
    document.removeEventListener('keydown', handleKeyDown);
  };

  /**
   * Handles keyboard shortcuts
   */
  const handleKeyDown = (e) => {
    // Escape key closes modal
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
    }
    // Enter key confirms (if confirm button is focused or no input elements have focus)
    else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      const activeElement = document.activeElement;
      // Don't trigger if user is typing in a textarea or input
      if (activeElement && (activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'INPUT')) {
        return;
      }
      e.preventDefault();
      handleConfirm();
    }
  };

  /**
   * Handles confirm button click
   */
  const handleConfirm = async () => {
    if (isClosing) return;

    // Disable confirm button to prevent double-clicks
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Processing...';
    }

    try {
      // Call onConfirm callback if provided
      if (onConfirm && typeof onConfirm === 'function') {
        await onConfirm();
      }

      // Close modal after successful confirmation
      isClosing = true;
      if (modal.parentNode) {
        document.body.removeChild(modal);
      }
      document.removeEventListener('keydown', handleKeyDown);
    } catch (error) {
      // Re-enable button if there was an error
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = confirmText;
      }
      isClosing = false;

      // Error handling is done by the onConfirm callback (e.g., showing toast)
      // We just log it here for debugging
      console.error('[ModalHelper] Error in onConfirm callback:', error);
    }
  };

  /**
   * Handles click-outside-to-close behavior
   */
  const handleOverlayClick = (e) => {
    // Close if clicking on overlay (not on modal dialog itself)
    if (e.target === modal) {
      closeModal();
    }
  };

  // Add event listeners
  closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeModal);
  }
  confirmBtn.addEventListener('click', handleConfirm);
  modal.addEventListener('click', handleOverlayClick);
  document.addEventListener('keydown', handleKeyDown);

  // Focus the confirm button by default for keyboard accessibility
  setTimeout(() => {
    if (confirmBtn) {
      confirmBtn.focus();
    }
  }, 100);
}

/**
 * Escapes HTML special characters to prevent XSS
 * Used for plain text content that should not contain HTML
 *
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
