# Bug 7688: Owner payout proposal pays the full amount while a third-party share is on hold

Reported by Fleet partner desk. Reviewed by the product owner (decision below).

Every month `CGR Payout Suggestion.Suggest(CutoffDate)` (Leasing) proposes what we pay our vehicle owners. A statement line can carry third-party shares: parts of the amount we pay to someone else, usually the owner's financing bank. A share can be put On Hold when the bank asks us to wait.

Report from the desk: "Owner 4410 has a 200.30 share on hold, but the proposal still has the full 1,000.55 for the owner. Please take the held share off and pay the owner 800.25."

Product owner decision: take every open share off the owner's amount, whether it is on hold or not, and whether it is due yet or not. But do not pay a statement while all of its open shares are on hold. Paying the owner then would settle the statement behind the bank's back. So:

- The owner's payout line is reduced by all open third-party shares. Closed shares are not deducted.
- When all open shares of the statement are on hold, the owner's payout line is proposed with To Be Paid off.
- Nobody can switch To Be Paid on for such an owner line while its shares are still all on hold. Once a hold is released, it can be switched on again. The desk should get the error the moment they tick the box, not when they leave the line.
- Payout lines for the shares themselves are proposed as today: only for shares that are open, not on hold and due by the cutoff. They can be switched on and off freely.
- Statements without open shares are proposed as today.

Reproduction (cutoff 31 May 2027):

1. Statement for owner 4410, due 15 May 2027, amount 1,000.55, with one open share of 200.30 on hold.
2. Suggest: the owner's line is 1,000.55 and To Be Paid is on. Expected: 800.25 with To Be Paid off.
