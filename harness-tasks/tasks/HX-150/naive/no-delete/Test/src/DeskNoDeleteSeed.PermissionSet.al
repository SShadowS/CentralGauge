permissionset 80573 "CGR LEDGER SEED NO D"
{
    Assignable = true;
    Caption = 'CGR desk ledger tests: arrange and assert';
    Permissions =
        tabledata "CGR Setup" = RIMD,
        tabledata "CGR Vehicle" = RIMD,
        tabledata "CGR Damage Entry" = RIMD,
        tabledata "CGR Rental Contract" = RIMD,
        tabledata "CGR Rental Ledger Entry" = RIMD,
        tabledata "CGR Outbox Entry" = RIMD,
        table "CGR Rental Ledger Entry" = X;
}
