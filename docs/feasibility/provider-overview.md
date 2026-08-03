# VinkIn — Overview for Financial Providers

_Audience: provider partnerships / program teams. One page. Send together with
`funds-flow.md` and `provider-questionnaire.md`._

## What VinkIn is

VinkIn lets a group of consumers pay for **one in-person purchase together, at the register,
in real time**. The organizer enters the final total, the group members each approve and pay
their share (Apple Pay / Google Pay / card, including guests on mobile web with no app), and
VinkIn issues a **single-use virtual card** limited to the funded amount. The organizer
presents that card once; the merchant sees one ordinary card payment. No merchant integration
exists or is required.

## The transaction, concretely

```text
Grocery register shows $128.43
→ organizer starts a VinkIn session for $128.43
→ 3 friends scan a QR code and each approve ~$32.11 (authorization, then capture)
→ VinkIn pools the captured funds and issues a virtual card capped at $128.43
→ organizer pays the register with the card; card is then locked to that merchant
→ card closes after the settlement window
```

Sessions live for minutes, not days. One card per session, one merchant per card, amount-capped,
cash-like MCCs blocked.

## V1 risk posture

- United States only, USD only
- Low per-session limits (initial cap on total and on organizer exposure)
- Full KYC on organizers (the card user); participants are payers only
- Mandatory organizer backup payment method for post-settlement variances (e.g., restaurant tips)
- No ACH, no ATM/cash access, no P2P transfer, no crypto, no gambling, no gift cards
- Closed beta with an invited user group and manual operational oversight

## What we are asking of a provider

1. **Collection**: card/wallet acceptance from participants (auth + manual capture + refunds).
2. **Issuing**: programmatic single-use virtual cards funded from collected balances, with
   amount controls and real-time authorization decisioning available to us.
3. **A program structure** under which pooling participant funds toward one card spend by a
   consumer organizer is permitted — this is the core question in `provider-questionnaire.md`,
   and we are explicitly seeking a written answer before building on your platform.

Engineering status: the platform is architected provider-neutrally (typed provider interface,
conformance test suite, mock provider). We can begin sandbox validation immediately on receipt
of credentials.
