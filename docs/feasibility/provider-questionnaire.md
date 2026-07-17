# VinkIn — Provider Questionnaire

_Send with `provider-overview.md` and `funds-flow.md`. We are requesting **written** answers;
they become gate evidence under `docs/feasibility/responses/`. Where an answer is "not
supported", we ask what adjacent structure you do support._

## A. Program structure (existential — answers gate the whole build)

1. May **multiple consumers fund a single purchase** on your platform, with the pooled amount
   spent through one platform-issued virtual card? Under which program type?
2. **Who owns/controls collected participant funds** between capture and card settlement in
   your structure (platform balance, FBO account, other)? What does that imply for us
   legally (money transmission, agent-of-payee, sponsor-bank coverage)?
3. May a **consumer organizer be the cardholder** (or authorized user) of that virtual card
   for a personal purchase? If your issuing program is business-only, what structure, if any,
   permits consumer end-users to present the card in person?
4. Do you support **consumer cardholders** natively? What KYC is required, on whom, at what
   thresholds — organizer only, or participants too?
5. What **licensing or sponsor-bank structure** does this program require of VinkIn, if any?

## B. Collection (participant side)

6. Confirm support and any constraints for: authorization with **manual capture**, partial
   capture, authorization-hold duration, cancel/release, refunds, and refund timing.
7. Confirm **Apple Pay and Google Pay** acceptance on mobile web for guest payers (no app,
   no account), including domain verification requirements.
8. What are your fraud tooling and 3DS options for an **unauthenticated guest checkout**
   endpoint (a known card-testing magnet)?

## C. Funding and liquidity

9. After we capture participant charges, **how quickly are those funds usable to fund
   issuing spend**? Is the collection-balance → issuing-balance transfer internal and
   near-instant, or does it ride payout rails?
10. What **prefunding/reserves** do you require for an issuing program of this shape, and how
    are reserve levels set and reviewed?
11. What happens when a merchant capture **exceeds available program funds** (e.g., a tip
    settles above the card's funded amount)? Is the authorization-time limit the hard stop,
    or can captures exceed it, and who is liable for the gap?

## D. Issuing and authorization

12. Confirm **single-use/amount-capped virtual card issuance** latency (we need seconds, at
    the register) and per-card spending controls: amount cap, MCC allow/block lists,
    merchant-level restrictions if any.
13. Do we get **real-time authorization decisioning** (synchronous webhook / auth stream)?
    What is the decision deadline, and what is the default outcome if we miss it?
14. What merchant identity data does the **authorization payload** carry (merchant id, name,
    MCC, country, terminal id)? We lock each card to the first merchant ourselves and need
    stable keys to do it.
15. Confirm behavior for partial captures, incremental authorizations, multicapture, and
    extended authorizations on issued cards — which exist, which don't.

## E. Settlement, disputes, recovery

16. **Which party carries dispute and fraud liability** on (a) participant contribution
    charges and (b) issued-card merchant transactions? What are the descriptor and
    merchant-of-record designations on participant charges?
17. Confirm we may **charge a saved consumer payment method off-session** to recover a
    post-settlement variance the organizer agreed to in our terms (mandate/consent
    requirements, SCA exemptions if any).
18. What settlement reporting do we get for reconciliation (files/APIs, latency,
    capture-vs-auth variance visibility)?

## F. Constraints and pricing

19. Which **MCCs and transaction types are prohibited** for this program beyond our own
    blocklist (we already exclude cash-like, gambling, gift cards, fuel, hotels, rentals)?
20. Full **pricing**: acceptance (card + wallet), issuing (per card, per authorization),
    interchange share if any, refunds, disputes, and any program/platform fees.
21. What are your **sandbox's limitations** relative to production for the behaviors above —
    what can we not validate before go-live?
