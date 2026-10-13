# Bug 7594: Vehicles with imported damages are still rented out

Reported by the Fleet desk.

Last sprint we shipped the codeunit `CGR Damage Import` (Fleet). The workshop system hands us its damage reports as lines in a temporary `CGR Damage Entry` record, and we call `ImportDamages(var Lines: Record "CGR Damage Entry" temporary): Integer`, which stores every line for a known vehicle with a description as a damage entry (keeping the workshop's Reported On and Repaired values) and returns how many it stored.

Observed since go-live: vehicles whose damages arrived through the import stay available. They are not blocked, their Open Damages stays 0, and the rental desk can check them out.

Expected:

- Every damage entry stored for a vehicle blocks the vehicle and adds one to its Open Damages, exactly once, however the entry was created: through `CGR Damage Mgt.RegisterDamage`, a return with damage, the workshop import, or other apps that insert damage entries themselves.
- A damage entry that is stored already repaired does not block the vehicle and does not count as an open damage.
- Damage entries that are only held in memory (the import's own processing, temporary records in other code) change no vehicle.
- Repairing damages works as today.
- `ImportDamages` keeps its signature, its return value and which lines it stores.

Reproduction:

1. Vehicle V-7 exists, is not checked out and not blocked, and has no damage entries.
2. Put one line into a temporary `CGR Damage Entry`: Vehicle No. V-7, Description `Cracked windscreen`, Reported On 2027-02-20.
3. `ImportDamages(Lines)` returns 1, and a damage entry for V-7 is stored.
4. V-7 is not blocked, its Open Damages is 0, and a rental contract for V-7 can be checked out.
5. Expected: V-7 is blocked with Open Damages 1, and `CGR Fleet Mgt.IsAvailable('V-7')` returns false.
