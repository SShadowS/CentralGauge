permissionset 80524 "CGR ROLE DO SEED"
{
    Assignable = true;
    Caption = 'CGR role tests: arrange and assert';
    Permissions =
        tabledata "CGR Setup" = RIMD,
        tabledata "CGR Vehicle" = RIMD,
        tabledata "CGR Damage Entry" = RIMD,
        tabledata "CGR Rental Contract" = RIMD,
        tabledata "CGR Rental Ledger Entry" = RIMD,
        tabledata "CGR Outbox Entry" = RIMD;
}
