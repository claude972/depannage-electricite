# Indicative prices (PUB-02 / ADM-08)

Strict mirror of the public view of `lib/features/indicative-prices/handler.ts` (`model.ts`), one shared
GET per page. Public displays (home cards, service page hero / related / bar, « Tarifs » table) read the
five ranges; before the read or on error they show honest fallback wording, never a number. Always
« indicatif ». Bookings and dossiers keep their own reserved estimate (never re-priced here).
`IndicativePricesAdmin` — read-only « Barème public » (active version + « publication fermée ») while
`publication_available=false`: no stage form, no publish button.
