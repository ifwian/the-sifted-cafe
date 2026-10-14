// =====================================================================
// Business rules for reservations - ONE place to change them.
//
// Every value below is PROVISIONAL. The owner interview
// (docs/INTERVIEW_QUESTIONNAIRE.md) has not been done yet, so these are
// sensible defaults, not confirmed facts. After the interview, edit this
// file only; the website form and the server both read from it.
//
// Where a value came from:
//   - Branch names and opening hours: copied from the existing
//     TheSiftedCafe repository (client/src/data/businessInfo.js).
//   - Everything else: a default chosen by the developer.
// =====================================================================

module.exports = {
  // Time zone used to decide what "today" and "now" mean for the cafe.
  timezone: 'Asia/Manila',

  // Branches shown in the reservation form. "id" is what is saved in the
  // database; "name" is what customers see. Times are 24-hour "HH:MM".
  branches: [
    { id: 'calamba', name: 'Calamba', open: '09:00', close: '21:00' },
    { id: 'cabuyao', name: 'Cabuyao', open: '10:00', close: '22:00' },
  ],

  // Reservation times are offered every N minutes.
  slotMinutes: 30,

  // The last bookable time is this many minutes before closing.
  lastBookingBeforeCloseMinutes: 60,

  // A request for today must be at least this many minutes from now.
  minLeadMinutes: 60,

  // How far ahead a customer can request (in days from today).
  maxDaysAhead: 60,

  // Allowed party size. Bigger groups should contact the cafe directly.
  minGuests: 1,
  maxGuests: 20,

  // Reservation statuses. New requests are always 'pending'.
  // (Must match the ENUM in database.sql.)
  statuses: ['pending', 'confirmed', 'cancelled', 'completed', 'no_show'],
};
