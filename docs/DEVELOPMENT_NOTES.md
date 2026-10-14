# Development notes

## 1. What the existing repository contained (inspected once)
`github.com/ifwian/TheSiftedCafe` (read-only clone; **not modified**): a React + Vite + Tailwind client, an Express + Prisma + PostgreSQL server, 22 milestones, 3 images (`drinks.jpg`, `interior.jpg`, `the-sifted.jpg`), icons. Because the course stack is plain HTML/CSS/JS + Express + MySQL, none of the React/Prisma code could be reused; the **brand and content** were carried over instead:

| Carried over | From |
|---|---|
| Palette: cream `#eadec7`, royal blue `#1b2b85`, crimson `#c82a1d`, ochre `#e08a27`, yellow `#ffcd00`, green `#1b6a3b` | `client/src/index.css` |
| Fonts: Fraunces (headings), Inter (text) | `client/index.html`, `index.css` |
| Tagline "Good coffee. Good food. Good people.", hero line, About/values wording | repo content |
| Branches Calamba and Cabuyao, opening hours, Calamba address, Facebook/Instagram links | `client/src/data/businessInfo.js` |
| Six featured items (names/descriptions only, **no prices**) | `client/src/data/mockMenu.js` |
| Photos `drinks.jpg`, `interior.jpg`; icon `the-sifted.jpg` | `client/public` |

Not carried over: the original's invented testimonials and mock prices (the brief forbids inventing these), PostgreSQL/Prisma, JWT, Cloudinary, email sending.

Other images in `public/images/` (`cafe-counter`, `record-shelf`, `seating-corner`, `wall-calendar`, `cafe-interior`, `logo-full`, `logo-wordmark`, favicons) were already in the working folder when this build was resumed; their origin was not recorded in this build, so treat it as unverified. **Confirm with the owner that these photos and the logo may be used (CT-5).** Alt text describes what is visible in each.

## 2. Design
Original layout inspired by the *general* restaurant-homepage pattern (photo hero, form panel at the right, About, featured menu, gallery, visit, footer). No Italianni's text, logo, images or exact layout were used. Cream/blue/crimson palette and wordmark come from The Sifted Cafe. No decorative animation; only a basic transition and a mobile menu.

## 3. Decisions made because the owner has not been interviewed
| Decision | Why | Easy to change |
|---|---|---|
| Status starts as Pending; staff confirm | The brief forbids claiming confirmation without a real rule | — |
| No availability check; wording says "request" | Capacity rules are unknown (LIM-1) | add after interview |
| Times every 30 min, last 60 min before close, 60 min lead time, 60 days ahead, 1–20 guests | Typical café defaults | `server/config.js` |
| Email optional | Phone is the usual contact; unknown | `validation.js` + form |
| Menu shown without prices | Real prices unknown | `index.html` |
| Every admin has full rights, can delete | Unknown staffing | — |
| Branch select in the form | Two branches exist in the repo | `config.js` |

## 4. Project layout (differs slightly from the suggested tree)
- `public/css/base.css` holds the shared design tokens/buttons/forms used by both `style.css` (landing) and `admin.css`.
- `public/js/api.js` holds the shared `fetch` helper and date/time helpers used by `main.js`, `reservation.js`, `admin.js`.
- `server/` has small single-purpose files: `config.js`, `validation.js`, `listQuery.js`, `session.js`, `dbErrors.js` (pure, unit-tested) plus `routes/` and `middleware/`.
- `scripts/` holds `create-admin.js`, `check-endpoints.js`, `run-tests.js`.

## 5. Build environment limits (see `TESTING.md`)
No MySQL and no npm registry access. Consequently `package-lock.json` is **not** included (npm creates it on your first `npm install`), and the live stack was verified only through a stand-in server. All SQL was reviewed by reading, not executed.

## 6. Interview log
*Not done yet.* After the interview, summarise the answers here with the date, and update `REQUIREMENTS.md`, `server/config.js` and the TBC text on the site.

## 7. Ideas for later
Email/SMS notices, table capacity per slot, customer self-cancel link, CSV export, daily printable list, data-retention job, more admin roles, hosting behind HTTPS.
