begin;
-- No currency conversion of prior data: incompatible rows fail migration for explicit review.
alter table subscription_private.offers add constraint subscription_offers_eur_only check(currency='eur');
alter table subscription_private.attempts add constraint subscription_attempts_eur_only check(offer->>'currency' is not null and offer->>'currency'='eur');
commit;
