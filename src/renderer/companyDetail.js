/**
 * Company Detail View (v1.4)
 *
 * Displays company information, contacts in the company, and meeting history.
 * Accessible by clicking an organization name in the contact detail view.
 */

import { escapeHtml } from './security.js';

let _currentCompany = null;

/**
 * Open the company detail panel within the contacts view.
 * @param {string} organization - Company/organization name
 */
export async function openCompanyDetail(organization) {
  _currentCompany = organization;
  const detailContent = document.getElementById('contactDetailContent');
  if (!detailContent) return;

  detailContent.innerHTML = `
    <div class="company-detail-loading" style="padding: 24px; text-align: center; color: var(--text-secondary);">
      Loading company details...
    </div>`;

  try {
    // Fetch company contacts and meetings in parallel
    const [contactsResult, meetingsResult] = await Promise.all([
      window.electronAPI.contactsGetCompanyContacts(organization),
      window.electronAPI.contactsGetCompanyMeetings(organization),
    ]);

    const contacts = contactsResult.success ? contactsResult.contacts : [];
    const meetings = meetingsResult.success ? meetingsResult.meetings : [];

    renderCompanyDetail(organization, contacts, meetings);
  } catch (error) {
    console.error('[CompanyDetail] Failed to load:', error);
    detailContent.innerHTML = `
      <div class="company-detail-error" style="padding: 24px; color: var(--color-error);">
        Failed to load company details: ${escapeHtml(error.message)}
      </div>`;
  }
}

function renderCompanyDetail(organization, contacts, meetings) {
  const detailContent = document.getElementById('contactDetailContent');
  if (!detailContent) return;

  // Extract domains from contact emails
  const domains = new Set();
  for (const contact of contacts) {
    if (contact.emails) {
      for (const email of contact.emails) {
        const domain = email.split('@')[1];
        if (domain) domains.add(domain);
      }
    }
  }

  let html = `
    <div class="company-detail" style="padding: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px;">
        <div>
          <h2 style="margin: 0 0 4px; font-size: 20px;">${escapeHtml(organization)}</h2>
          <div style="color: var(--text-secondary); font-size: 13px;">
            ${contacts.length} contact${contacts.length !== 1 ? 's' : ''}
            &middot; ${meetings.length} meeting${meetings.length !== 1 ? 's' : ''}
            ${domains.size > 0 ? `&middot; ${Array.from(domains).map(d => escapeHtml(d)).join(', ')}` : ''}
          </div>
        </div>
        <button class="btn btn-outline btn-sm" id="companyBackBtn" style="flex-shrink: 0;">
          &larr; Back to Contact
        </button>
      </div>`;

  // Contacts section
  html += `
      <div style="margin-bottom: 24px;">
        <h3 style="font-size: 14px; font-weight: 600; margin-bottom: 12px; color: var(--text-secondary);">
          Contacts (${contacts.length})
        </h3>
        <div style="display: grid; gap: 8px;">`;

  for (const contact of contacts) {
    const email = contact.emails?.[0] || '';
    const title = contact.title || '';
    html += `
          <div class="company-contact-card" data-email="${escapeHtml(email)}"
               style="padding: 12px; background: var(--bg-secondary, #f5f5f5); border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 12px;">
            <div style="width: 36px; height: 36px; border-radius: 50%; background: var(--primary-color); color: white; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 14px; flex-shrink: 0;">
              ${escapeHtml((contact.name || '?')[0].toUpperCase())}
            </div>
            <div style="min-width: 0;">
              <div style="font-weight: 500; font-size: 14px;">${escapeHtml(contact.name || 'Unknown')}</div>
              <div style="font-size: 12px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${title ? escapeHtml(title) + ' &middot; ' : ''}${escapeHtml(email)}
              </div>
            </div>
          </div>`;
  }

  html += `</div></div>`;

  // Meetings section
  html += `
      <div>
        <h3 style="font-size: 14px; font-weight: 600; margin-bottom: 12px; color: var(--text-secondary);">
          Meeting History (${meetings.length})
        </h3>`;

  if (meetings.length === 0) {
    html += `<p style="color: var(--text-secondary); font-size: 13px;">No meetings found with this company.</p>`;
  } else {
    html += `<div style="display: grid; gap: 8px;">`;
    // Show most recent 50 meetings
    for (const meeting of meetings.slice(0, 50)) {
      const date = meeting.date ? new Date(meeting.date).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      }) : 'Unknown';
      html += `
            <div class="company-meeting-card" data-meeting-id="${escapeHtml(meeting.id)}"
                 style="padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 6px; cursor: pointer;">
              <div style="font-weight: 500; font-size: 14px;">${escapeHtml(meeting.title || 'Untitled')}</div>
              <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">${date}</div>
            </div>`;
    }
    html += `</div>`;
  }

  html += `</div></div>`;

  detailContent.innerHTML = html;

  // Bind handlers
  const backBtn = document.getElementById('companyBackBtn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      // Go back to the contact that was showing before
      // Emit a custom event that contacts.js can listen to
      document.dispatchEvent(new CustomEvent('company-detail-back'));
    });
  }

  // Click on contact card to navigate to that contact
  detailContent.querySelectorAll('.company-contact-card').forEach(card => {
    card.addEventListener('click', () => {
      const email = card.dataset.email;
      if (email && window.openContactsView) {
        window.openContactsView(email);
      }
    });
  });

  // Click on meeting card to open the meeting
  detailContent.querySelectorAll('.company-meeting-card').forEach(card => {
    card.addEventListener('click', () => {
      const meetingId = card.dataset.meetingId;
      if (meetingId) {
        // Close contacts view and open meeting
        const contactsView = document.getElementById('contactsView');
        const mainView = document.getElementById('mainView');
        if (contactsView) contactsView.style.display = 'none';
        if (mainView) mainView.style.display = 'block';
        if (window.showEditorView) window.showEditorView(meetingId);
      }
    });
  });
}
