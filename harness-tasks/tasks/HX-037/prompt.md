# Bug 7538: Contract check fails instead of listing the problems

Reported by Finance.

Last sprint we shipped the codeunit `CGR Contract Check` (Rental). Finance calls `CheckForPosting(ContractNo: Code[20]; var Problems: List of [Text]): Boolean` before posting a rental contract, to see everything that is wrong with it in one go. Extensions add their own checks by subscribing to `OnCheckContractForPosting` and reporting each problem as a collectible error, as described in the codeunit.

Observed since go-live:

- A contract with two problems does not return a list. The call fails with `Multiple errors occurred during the operation the first of which is: Rental contract RC5 must be returned before it is posted. All errors can be found under 'Detailed Information'.`
- A contract with one problem fails with that problem's text.
- A contract with problems reported by an extension fails in the same way.

Expected:

- `CheckForPosting` raises no error for problems. It returns false and `Problems` holds the message of every problem: our own checks first, in this order (not returned, no customer name, vehicle with open damages), then the problems reported by extensions, in the order they were reported.
- It returns true and `Problems` is empty when nothing is wrong.
- `Problems` only ever holds the problems of the contract just checked, also when the same list is passed again for another contract.
- An ordinary (non-collectible) error raised by an extension still stops the check with that error, as today.
- The public signature, the event and the message texts stay as they are.

Reproduction:

1. Rental contract RC5 with status Open, an empty Customer Name, and a vehicle that is not blocked.
2. `CheckForPosting('RC5', Problems)` fails with the error above.
3. Expected: false, and `Problems` = [`Rental contract RC5 must be returned before it is posted.`, `Rental contract RC5 has no customer name.`].
