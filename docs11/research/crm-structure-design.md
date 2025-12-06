# RD-4: Contact/Company CRM Structure Design

## Summary

This document defines the architecture for creating a CRM-like system in Obsidian with contact and company pages. These pages will be linked from meeting transcripts and could potentially enhance or replace the routing.yaml system.

---

## Research Findings

### 1. Obsidian Bases (New Core Feature - 2025)

Obsidian Bases is a new built-in feature for creating database-like views:

**Capabilities:**

- YAML-based `.base` files
- Table, card, kanban views
- Filtering by properties, tags, folders
- Formula support for computed fields
- Grouping and sorting

**Example Base for Contacts:**

```yaml
# contacts.base
filters:
  and:
    - file.inFolder("People")
    - file.hasTag("contact")
views:
  - type: table
    name: 'All Contacts'
    order:
      - company
      - file.mtime
```

**Limitations:**

- Read-only views (can't create/edit from Base)
- Requires understanding YAML syntax
- Still relatively new, evolving feature

### 2. Traditional Markdown Approach (Recommended)

One markdown file per contact/company with YAML frontmatter:

**Pros:**

- Simple, portable, future-proof
- Works with any Obsidian version
- Full power of wiki-links and backlinks
- Easy to generate programmatically
- Compatible with existing Obsidian workflows

**Cons:**

- No built-in table view (need Dataview plugin or Bases)
- Manual linking required

### 3. Community CRM Patterns

From [Dann Berg's People Template](https://dannb.org/blog/2022/obsidian-people-note-template/):

- Use aliases for name variations (`[[John Smith]]`, `[[John]]`, `[[JS]]`)
- Link meetings to people via `attendees:` frontmatter
- Backlinks automatically show all related content

From [Obsibrain](https://docs.obsibrain.com/features/meetings-and-crm):

- Dedicated `/People` folder
- `[[Name]]` linking in notes
- Quick command to create new contacts

---

## Recommended Architecture

### Folder Structure

```
vault/
├── People/
│   ├── John Smith.md
│   ├── Jane Doe.md
│   └── ...
├── Companies/
│   ├── ACME Corp.md
│   ├── TechStartup Inc.md
│   └── ...
├── clients/
│   └── acme-corp/
│       └── meetings/
│           └── 2024-12-03-quarterly-review.md
└── config/
    └── routing.yaml
```

### Contact Template

```markdown
---
type: person
name: 'John Smith'
aliases:
  - 'John'
  - 'J. Smith'
emails:
  - john.smith@acme.com
  - jsmith@gmail.com
company: '[[ACME Corp]]'
role: 'VP of Engineering'
phone: '+1-555-123-4567'
google_contact_id: 'people/abc123'
linkedin: 'https://linkedin.com/in/johnsmith'
tags:
  - contact
  - client
created: 2024-12-03
---

# John Smith

VP of Engineering at [[ACME Corp]]

## Contact Info

- **Email:** john.smith@acme.com
- **Phone:** +1-555-123-4567
- **LinkedIn:** [Profile](https://linkedin.com/in/johnsmith)

## Notes

<!-- Add notes about this person here -->

## Recent Meetings

<!-- Backlinks will show all meetings where [[John Smith]] appears -->
```

### Company Template

```markdown
---
type: company
name: 'ACME Corp'
aliases:
  - 'ACME'
  - 'Acme Corporation'
domain: 'acme.com'
industry: 'Manufacturing'
website: 'https://acme.com'
contacts:
  - '[[John Smith]]'
  - '[[Jane Doe]]'
routing_folder: 'clients/acme-corp'
tags:
  - company
  - client
created: 2024-12-03
---

# ACME Corp

Manufacturing company based in Springfield.

## Key Contacts

- [[John Smith]] - VP of Engineering
- [[Jane Doe]] - Product Manager

## Notes

<!-- Add notes about this company here -->

## Recent Meetings

<!-- Backlinks will show all meetings mentioning [[ACME Corp]] -->
```

### Meeting Transcript Linking

In transcripts, replace speaker labels with wiki-links:

**Before:**

```markdown
[00:00] Speaker A: Welcome to the call.
[00:05] Speaker B: Thanks for having me.
```

**After:**

```markdown
[00:00] [[John Smith]]: Welcome to the call.
[00:05] [[Jane Doe]]: Thanks for having me.
```

Also add participants to frontmatter:

```yaml
---
meeting_id: 'meeting-1733234567890'
title: 'Q4 Planning Session'
participants:
  - '[[John Smith]]'
  - '[[Jane Doe]]'
company: '[[ACME Corp]]'
---
```

---

## Integration with Routing System

### Option A: Coexist (Recommended for v1.1)

Keep `routing.yaml` for email-based routing, add company pages as enhancement:

```yaml
# routing.yaml (unchanged)
clients:
  - name: 'ACME Corp'
    slug: 'acme-corp'
    domains:
      - 'acme.com'
```

Company pages provide additional metadata and backlink functionality.

### Option B: Replace (Future Consideration)

Company pages could replace routing.yaml:

- Route based on `routing_folder` property in company file
- Match by `domain` property
- More flexible, user-editable in Obsidian

**Challenges:**

- Need to scan company files on startup
- Slower than YAML lookup
- Users must maintain company pages

---

## Auto-Generation Workflow

### When to Create Contact Pages

1. **On first meeting with new contact:**
   - Speaker matched to email via Google Contacts
   - Check if People/[Name].md exists
   - If not, create from template

2. **On speaker mapping in UI:**
   - User maps "Speaker A" → contact
   - Create page if doesn't exist

### When to Create Company Pages

1. **On first meeting with new company domain:**
   - Email domain matches no existing company
   - Offer to create company page

2. **From routing.yaml sync:**
   - Generate company pages from existing routing config

### Page Update Workflow

1. **After each meeting:**
   - Update `contacts` list on company page
   - No need to update contact pages (backlinks work automatically)

---

## Linking Syntax Decision

### Wiki-links vs. Markdown Links

| Syntax    | Example                                | Pros                                      | Cons                  |
| --------- | -------------------------------------- | ----------------------------------------- | --------------------- |
| Wiki-link | `[[John Smith]]`                       | Native Obsidian, auto-complete, backlinks | Obsidian-specific     |
| Markdown  | `[John Smith](People/John%20Smith.md)` | Portable                                  | No backlinks, verbose |

**Recommendation:** Use wiki-links (`[[Name]]`) for full Obsidian integration.

### Handling Name Variations

Use frontmatter aliases:

```yaml
aliases:
  - 'John'
  - 'J. Smith'
  - 'Johnny'
```

All variations resolve to the same page.

---

## Files to Create/Modify

| File                                      | Changes                                      |
| ----------------------------------------- | -------------------------------------------- |
| `src/main/templates/contactTemplate.js`   | New - Generate contact page markdown         |
| `src/main/templates/companyTemplate.js`   | New - Generate company page markdown         |
| `src/main/storage/VaultStructure.js`      | Add createContactPage(), createCompanyPage() |
| `src/main/integrations/SpeakerMatcher.js` | Link to contact pages on speaker mapping     |
| Transcript formatter                      | Replace speaker labels with wiki-links       |

---

## UI Considerations

### Contact Quick-Create

When mapping a speaker to a contact for the first time:

1. Show contact details from Google Contacts
2. Option to "Create Obsidian page for this contact"
3. Auto-fill template with available data

### Company Page Link

In meeting detail view:

- Show company (if detected)
- "Create company page" button if none exists
- Link to existing company page in Obsidian

---

## Testing Checklist

- [ ] Verify contact page template generation
- [ ] Verify company page template generation
- [ ] Test wiki-link insertion in transcripts
- [ ] Test backlinks show meetings on contact page
- [ ] Test backlinks show meetings on company page
- [ ] Verify aliases work for name variations
- [ ] Test Google Contacts data population
- [ ] Test company detection from email domain

---

## References

- [Dann Berg's People Template](https://dannb.org/blog/2022/obsidian-people-note-template/)
- [Obsibrain CRM](https://docs.obsibrain.com/features/meetings-and-crm)
- [Obsidian Bases Documentation](https://help.obsidian.md/bases)
- [Obsidian Forum: CRM in Markdown](https://forum.obsidian.md/t/crm-system-in-markdown-in-obsidian/15691)
