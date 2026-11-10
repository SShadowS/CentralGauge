permissionset 70572 "CGR CLAIMS HANDLER"
{
    Assignable = true;
    Caption = 'CGR claims handler';
    Permissions =
        tabledata "CGR Vehicle" = R,
        tabledata "CGR Damage Entry" = R,
        codeunit "CGR Claim Export" = X;
}

permissionset 70573 "CGR FRONT DESK"
{
    Assignable = true;
    Caption = 'CGR front-desk agent';
    Permissions =
        tabledata "CGR Vehicle" = RM,
        tabledata "CGR Rental Contract" = RIM;
}
