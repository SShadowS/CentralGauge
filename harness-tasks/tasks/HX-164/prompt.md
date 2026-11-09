# Bug 5164: Repair invoices post the whole VAT as deductible

Reported by Finance.

Since Non-Deductible VAT was enabled for car repairs, the repair invoices we post from the workshops book their VAT as fully deductible. `CGR Repair Invoice Matching`.`MatchToWorkshopTotal` brings the purchase invoice in line with the total including VAT that the workshop printed, since workshops round VAT their own way. The total ends up right. The split between deductible and non-deductible VAT does not: on the VAT posting setup for repairs (25 % VAT, 50 % non-deductible) the extra or missing VAT all lands on the deductible side.

Expected:

- After MatchToWorkshopTotal the invoice's amount including VAT equals the workshop's total including VAT, whatever lines the workshop charged. Workshops often grant goodwill for a delay as a negative line on the invoice; such an invoice is matched like any other.
- The deductible and non-deductible VAT of the invoice follow the VAT posting setup of its lines after the matching.
- A difference above `CGR Setup`."Max. Workshop VAT Diff." is refused with the existing error and changes nothing.
- A company without Non-Deductible VAT behaves as it does today.

Keep the signature of MatchToWorkshopTotal.
