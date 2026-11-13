# Task 5167: Hand out the owner ledger file in a record

Requested by Reporting.

Vehicle owners get a file with the rental ledger entries of their vehicle for a period. Today `CGR Owner Ledger Export`.`BuildOwnerLedgerText` (Reporting) hands the file out as one Text, and long periods run into text limits and memory. The owners' pickup reads the file from a `CGR Owner Ledger File` record.

The new structure:

- Add `procedure WriteOwnerLedgerFile(VehicleNo: Code[20]; FromDate: Date; ToDate: Date; var OwnerFile: Record "CGR Owner Ledger File")` to `CGR Owner Ledger Export`. The caller has already inserted OwnerFile. WriteOwnerLedgerFile writes the owner's ledger file for the vehicle and period into OwnerFile.Content, and the caller reads the file back from Content.

Everything else stays as it is today: Content holds, byte for byte, the lines BuildOwnerLedgerText builds today, line ends included, also for an entry whose rental contract no longer exists. The owners' systems read the file as UTF-8, and customer names with æ, ø and å arrive intact.
