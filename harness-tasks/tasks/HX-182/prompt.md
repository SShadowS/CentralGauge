# Feature 5182: Damage roster for a period

Requested by the workshop.

Reporting has the damage roster: table `CGR Damage Roster Buffer` (70595), query `CGR Vehicle Damage Roster` (70596) and codeunit `CGR Damage Roster` (70597) with `FillRoster(var Buffer: Record "CGR Damage Roster Buffer" temporary)`, which lists every vehicle with the number of damage entries ever reported on it.

The workshop plans its inspections per period and wants the same roster for a period. Add `FillPeriodRoster(FromDate: Date; ToDate: Date; var Buffer: Record "CGR Damage Roster Buffer" temporary)` to `CGR Damage Roster`. It lists every vehicle, as the roster does, with "Damages Reported" set to the number of the vehicle's `CGR Damage Entry` rows whose "Reported On" is within FromDate..ToDate, and 0 for a vehicle that had no damage reported in the period: the workshop gives its free inspection slots to exactly those vehicles. After a fill, the buffer holds only the rows of that fill.

`FillRoster` keeps working as it does today.
