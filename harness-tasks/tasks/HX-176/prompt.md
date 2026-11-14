# Task 5176: A public summary for lease return charges

Requested by Leasing.

When a lease ends, `CGR Lease Return Proposal`.`BuildReturnProposal` (Leasing) builds the proposed return charges in a temporary `CGR Lease Return Charge` buffer and works out the proposal's summary: the number of lines and the total billed to the customer. Accepted proposals are stored in `CGR Lease Return Charge` by `AcceptReturnProposal`. The damage desk app builds its own return charge buffers and wants the same summary without copying our code.

The new structure:

- Move the summary code out of BuildReturnProposal into a new public procedure `SummarizeReturnCharges` on `CGR Lease Return Proposal`. It takes the return charge buffer as its first parameter and `var LineCount: Integer` as its second, sets LineCount to the number of lines, and returns the total as a Decimal. Other apps call it with a buffer they built.
- BuildReturnProposal uses SummarizeReturnCharges for its summary.

Everything else stays as it is today: a line that is not billed to the customer counts as a line and adds nothing to the total, and an empty buffer gives 0 lines and a total of 0.
