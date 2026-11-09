permissionset 80560 "CGR CLAIM TEST SEED"
{
    Assignable = true;
    Caption = 'CGR claim export tests: arrange and assert';
    Permissions =
        tabledata "CGR Vehicle" = RIMD,
        tabledata "CGR Damage Entry" = RIMD,
        tabledata "CGR Rental Contract" = RIMD;
}
