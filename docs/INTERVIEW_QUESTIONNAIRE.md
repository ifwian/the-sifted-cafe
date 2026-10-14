# Owner Interview Questionnaire — The Sifted Cafe Reservation System

**Purpose:** Our professor requires us to interview the café owner so the system reflects the real business. The website currently uses *provisional defaults* (see `REQUIREMENTS.md`). Your answers will confirm or replace them.

**How to use this sheet:** Print it or keep it open while interviewing. Record the owner's own words in the *Answer* column. Do not fill in answers yourself. Items marked **[CONFIRMS]** tell you which current default the answer settles, and **[CONFIG]** items can be changed in `server/config.js` without writing code.

| Interview details | |
|---|---|
| Interviewer(s) | |
| Person interviewed (name, role) | |
| Date / place / duration | |
| Consent to record notes (yes/no) | |

> Before you start, explain the project (a school project that proposes an online reservation system), that nothing is published as official, and that answers are used only for coursework. Ask permission before taking photos or recording.

---

## 1. Business background

| # | Question | Answer |
|---|---|---|
| 1.1 | Please tell us the story of The Sifted Cafe. When and why did it open? | |
| 1.2 | How many branches are there now, and are more planned? Which branches should take online reservations? **[CONFIRMS BR-1]** | |
| 1.3 | What is the exact name, full street address, and Google Maps location of each branch? (Cabuyao address is currently missing.) **[CONFIRMS CT-1]** | |
| 1.4 | What are the opening hours of each branch, including holidays and special closures? **[CONFIG: branches]** | |
| 1.5 | How many tables and seats does each branch have? What are the table sizes (2, 4, 6, long table)? | |
| 1.6 | Who are your typical customers (students, families, remote workers, groups)? | |
| 1.7 | Which days and times are busiest and quietest? | |

## 2. Current reservation methods

| # | Question | Answer |
|---|---|---|
| 2.1 | How do customers reserve today (walk-in, Facebook/Instagram message, phone, text, other)? | |
| 2.2 | How are reservations recorded (notebook, spreadsheet, chat history, memory)? | |
| 2.3 | How many reservations do you get on a normal day, a weekend, a holiday? | |
| 2.4 | How long does it take staff to handle one reservation request? | |
| 2.5 | Do you take reservations for every table, or only for groups? Is there a minimum party size? **[CONFIG: minGuests]** | |

## 3. Customer information requirements

| # | Question | Answer |
|---|---|---|
| 3.1 | What details do you need from the customer? (Currently: name, phone, optional email, branch, date, time, guests, special requests.) | |
| 3.2 | Is a phone number enough, or do you also need an email address? Should email be required? **[CONFIRMS FR-RES-3]** | |
| 3.3 | Do you need to know occasions (birthday, meeting), seating preference, allergies, or high-chair/wheelchair needs? | |
| 3.4 | Should customers be able to add food or cake pre-orders to a reservation? | |
| 3.5 | Do you want customer accounts or repeat-customer records? (The current design has none.) | |

## 4. Reservation scheduling and availability

| # | Question | Answer |
|---|---|---|
| 4.1 | What time slots should customers choose from (every 30 minutes, every hour)? **[CONFIG: slotMinutes]** | |
| 4.2 | What is the last reservation time before closing? **[CONFIG: lastBookingBeforeCloseMinutes]** | |
| 4.3 | How long does a typical reservation hold a table (e.g., 1.5 or 2 hours)? | |
| 4.4 | How much notice do you need (same-day allowed? minimum hours)? **[CONFIG: minLeadMinutes]** | |
| 4.5 | How far ahead can customers reserve? **[CONFIG: maxDaysAhead]** | |
| 4.6 | What is the maximum party size online? What should larger groups do? **[CONFIG: maxGuests]** | |
| 4.7 | Is there a limit on how many reservations or guests can be accepted per time slot? (The system does **not** check availability until you define this.) **[CONFIRMS LIM-1]** | |
| 4.8 | Are some days or periods blocked from reservations (holidays, private events)? | |
| 4.9 | Do you take whole-café bookings or events? How should those be handled? | |

## 5. Confirmation and cancellation policies

| # | Question | Answer |
|---|---|---|
| 5.1 | Should staff confirm every request manually, or should some be confirmed automatically? (Current default: always manual, status starts as *Pending*.) **[CONFIRMS BR-2]** | |
| 5.2 | How quickly should customers get a reply? Through which channel (call, text, email, Messenger)? | |
| 5.3 | What is your policy if a customer is late? How many minutes do you hold the table? | |
| 5.4 | How can customers cancel or change a reservation? Is there a deadline? | |
| 5.5 | Is there a deposit, minimum spend, or penalty for no-shows? | |
| 5.6 | Do you want to blacklist or flag repeated no-shows? | |

## 6. Common reservation problems

| # | Question | Answer |
|---|---|---|
| 6.1 | What goes wrong most often (double bookings, no-shows, unclear messages, missed messages)? | |
| 6.2 | Tell us about a recent reservation problem and how it was resolved. | |
| 6.3 | How much do no-shows affect the business? | |
| 6.4 | Are there fake or prank reservations? | |

## 7. Staff responsibilities

| # | Question | Answer |
|---|---|---|
| 7.1 | Who handles reservations at each branch (owner, manager, cashier, barista)? | |
| 7.2 | How many staff would use the admin page? Are they comfortable with computers or phones? | |
| 7.3 | Do different staff need different permissions (e.g., only view, or can delete)? (Currently every admin can do everything.) **[CONFIRMS SEC-3]** | |
| 7.4 | Will staff use a phone, tablet, or computer to manage reservations? | |
| 7.5 | During which hours will someone check new requests? | |

## 8. Admin management needs

| # | Question | Answer |
|---|---|---|
| 8.1 | What would you want to see first when you open the admin page (today's list, pending requests, upcoming week)? | |
| 8.2 | Which filters and searches matter (date, branch, status, name, phone)? | |
| 8.3 | Do you need to print a daily reservation list or export to Excel? | |
| 8.4 | Which statuses do you use? (Currently: Pending, Confirmed, Cancelled, Completed, No-show.) **[CONFIRMS statuses]** | |
| 8.5 | Do staff need private notes on a reservation? | |
| 8.6 | Should deleting a reservation be allowed, or should records only be marked cancelled? | |
| 8.7 | Do you want notifications (email, SMS, Messenger) when a new request arrives? | |

## 9. Website content and branding

| # | Question | Answer |
|---|---|---|
| 9.1 | Please confirm the official logo, brand colors, and fonts, and whether we may use the photos in the project. | |
| 9.2 | Please confirm or correct the "About" wording and the four values on the About section. **[CONFIRMS CT-2]** | |
| 9.3 | Which menu items should be featured? Do you want prices shown on the website? Please provide the real menu. **[CONFIRMS CT-3]** | |
| 9.4 | Which photos should be in the gallery? Who owns the photos and do we have permission? | |
| 9.5 | What phone number, email, and social links should appear publicly? **[CONFIRMS CT-1]** | |
| 9.6 | Do you want a menu page, online ordering, gift cards, or a blog? | |
| 9.7 | Should the site be available in English only? | |

## 10. Customer experience

| # | Question | Answer |
|---|---|---|
| 10.1 | What should a customer feel when they use the website? | |
| 10.2 | What do customers most often ask before visiting (parking, pets, Wi-Fi, outlets, halal, vegan)? | |
| 10.3 | What message should a customer see after sending a request? | |
| 10.4 | Which websites do you like or dislike, and why? | |

## 11. Privacy and data retention

| # | Question | Answer |
|---|---|---|
| 11.1 | Are you comfortable storing customer names and phone numbers in a database? Who may see them? | |
| 11.2 | How long should reservation records be kept (30 days, 1 year)? Should old records be deleted automatically? **[CONFIRMS PRIV-1]** | |
| 11.3 | Does the café have a privacy notice or consent wording for customer data? (The Philippines' Data Privacy Act may apply; the owner should confirm any legal obligations.) | |
| 11.4 | Where will the system be hosted, and who will back up the data? | |

## 12. Desired improvements

| # | Question | Answer |
|---|---|---|
| 12.1 | If the system could do one thing better than today, what would it be? | |
| 12.2 | Which features would you want in a future version (availability by table, reminders, deposits, menu management, reviews)? | |
| 12.3 | What would make you stop using the system? | |
| 12.4 | How will you measure success (fewer missed messages, fewer no-shows, time saved)? | |

---

## After the interview

1. Copy the confirmed answers into `REQUIREMENTS.md` (change status from *Provisional* to *Confirmed* and cite the question number).
2. Update `server/config.js` for every **[CONFIG]** item.
3. Update the text marked **TBC** on the website (search the project for `tbc`).
4. Add a short interview summary to `DEVELOPMENT_NOTES.md`, and keep the filled-in sheet for your professor.
