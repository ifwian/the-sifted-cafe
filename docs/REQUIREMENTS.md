# Requirements — The Sifted Cafe Reservation System

**Important:** The owner interview has **not** been done yet. Nothing below is a confirmed business rule. Every requirement carries one of these statuses:

| Status | Meaning |
|---|---|
| **Proposed** | A technical or usability requirement chosen by the developers (security, accessibility...). It does not depend on the owner. |
| **Provisional** | A business rule we had to guess so the system works. Implemented with a changeable default. Must be confirmed or replaced after the interview. |
| **Awaiting owner** | Information we do not have (and must not invent). The site shows a **TBC** marker or leaves it out. |
| **Confirmed** | Verified with the owner. *None yet.* |

Source of existing facts: the student's repository `ifwian/TheSiftedCafe` (branch names, opening hours, Calamba address, social links, sample menu wording). These are "from the existing project", not verified with the owner.

## 1. Business rules

| ID | Requirement | Status | Where to change |
|---|---|---|---|
| BR-1 | Two branches accept reservation requests: Calamba and Cabuyao. | Provisional (from existing repo) | `server/config.js` → `branches` |
| BR-2 | A new request is saved as **Pending**. Only signed-in staff confirm, cancel or complete it. The system never tells a customer a table is confirmed. | Provisional | `server/routes/reservations.js` |
| BR-3 | Opening hours: Calamba 9:00 AM–9:00 PM, Cabuyao 10:00 AM–10:00 PM, every day. | Provisional (from existing repo) | `server/config.js` → `branches` |
| BR-4 | Request times are offered every 30 minutes; the last one is 60 minutes before closing. | Provisional | `slotMinutes`, `lastBookingBeforeCloseMinutes` |
| BR-5 | A same-day request must be at least 60 minutes from now; requests are accepted up to 60 days ahead. | Provisional | `minLeadMinutes`, `maxDaysAhead` |
| BR-6 | Party size 1–20 online. Larger groups contact the café. | Provisional | `minGuests`, `maxGuests` |
| BR-7 | Statuses: Pending, Confirmed, Cancelled, Completed, No-show. | Provisional | `statuses` in config **and** the `ENUM` in `database.sql` |
| LIM-1 | **No availability checking.** The system does not know table counts or capacity, so it never says a slot is "available" or "full". Staff decide when they confirm. | Awaiting owner (limitation) | Needs table/capacity rules from the owner |
| BR-8 | Customers cannot cancel or edit online. They contact the café; staff update the record. | Awaiting owner | — |

## 2. Content

| ID | Requirement | Status |
|---|---|---|
| CT-1 | Cabuyao street address, phone number and email are shown as TBC. Social links come from the existing repo. | Awaiting owner |
| CT-2 | "About" text and the four value statements are carried over from the existing project. | Awaiting owner (to confirm) |
| CT-3 | Featured menu shows six sample items from the existing project with **no prices**. | Awaiting owner |
| CT-4 | No testimonials, ratings, awards or review counts are shown (none were supplied). | Proposed |
| CT-5 | The photos and logo may be used on the site. | Awaiting owner (confirm permission) |

## 3. Functional requirements

### Public website
| ID | Requirement | Status |
|---|---|---|
| FR-PUB-1 | One landing page with: navigation, hero with large photo, headline, calls to action, About, featured menu, gallery with photo viewer, visit-us/contact, footer. | Proposed |
| FR-PUB-2 | The reservation panel sits at the right of the hero on desktop and stacks below the hero text on phones. | Proposed |
| FR-PUB-3 | Opening hours shown on the page come from `server/config.js` (one source of truth). | Proposed |
| FR-PUB-4 | Items needing owner confirmation are visibly marked TBC; a banner explains the draft state. | Proposed |

### Reservation request
| ID | Requirement | Status |
|---|---|---|
| FR-RES-1 | Fields: name, contact number, email (optional), branch, guests, date, time, special requests (optional). | Provisional |
| FR-RES-2 | The form validates in the browser (quick feedback) and the server validates everything again. | Proposed |
| FR-RES-3 | Email is optional (a phone number is enough). | Provisional |
| FR-RES-4 | The request is saved in MySQL; a success message is shown **only** after the database confirms the save. On any failure the customer is told the request was **not** sent. | Proposed |
| FR-RES-5 | The success screen shows a reference (e.g. SC-00012) and says the request is pending, not confirmed. | Proposed |
| FR-RES-6 | Past dates, impossible dates, times outside the branch's request times, and invalid guest counts are rejected. | Provisional (limits) |
| FR-RES-7 | Spam protection: hidden honeypot field and a limit of 10 saved requests per device per 15 minutes. | Proposed |

### Staff (admin) page
| ID | Requirement | Status |
|---|---|---|
| FR-ADM-1 | Separate page `/admin` with username/password sign-in. | Proposed |
| FR-ADM-2 | Table of reservations with counts per status, search (name, phone, email, reference), filters (status, branch, date range), sorting and paging. | Proposed |
| FR-ADM-3 | View all details of one reservation. | Proposed |
| FR-ADM-4 | Edit details, status and private staff notes. | Proposed |
| FR-ADM-5 | Change status in one click from the detail view. | Proposed |
| FR-ADM-6 | Delete a reservation only after a confirmation dialog. | Proposed |
| FR-ADM-7 | Clear loading, empty, success and error states, including "session expired". | Proposed |
| FR-ADM-8 | The first admin account is created by a command (`npm run create-admin`), never by default credentials. | Proposed |

## 4. Security, privacy and quality

| ID | Requirement | Status |
|---|---|---|
| SEC-1 | Admin API routes are protected on the server, not only hidden in the browser. | Proposed |
| SEC-2 | Passwords stored as bcrypt hashes; login sessions use random tokens in HttpOnly, SameSite=Strict cookies; only a hash of the token is stored. | Proposed |
| SEC-3 | One admin role with full access. | Provisional (owner may want more roles) |
| SEC-4 | All SQL uses parameter placeholders; secrets live in `.env`, never in the browser or in the ZIP. | Proposed |
| SEC-5 | Customer text is shown with `textContent`, never `innerHTML`. | Proposed |
| PRIV-1 | Reservation records are kept until staff delete them. No retention period or privacy notice is implemented yet. | Awaiting owner |
| NFR-1 | Stack: HTML5, CSS3, vanilla JavaScript, Node.js, Express, MySQL. No frameworks. | Confirmed (course requirement) |
| NFR-2 | Responsive from 360 px phones to wide desktops. | Proposed |
| NFR-3 | Accessible: skip link, heading order, labels, error messages linked to fields, focus handling in dialogs, alt text, keyboard use. | Proposed |
| NFR-4 | Code is readable for second-year students. | Proposed |

## 5. Out of scope (not built)
Online payments or deposits, customer accounts, automatic email/SMS notifications, table-level availability, customer self-cancellation, multiple admin roles, menu management, data export, automatic deletion of old data. These can be added once the owner states which are needed.
