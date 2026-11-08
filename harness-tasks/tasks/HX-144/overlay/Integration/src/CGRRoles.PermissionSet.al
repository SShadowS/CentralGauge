permissionset 70480 "CGR DESK"
{
    Assignable = true;
    Caption = 'CGR desk agent';
    Permissions =
        tabledata "CGR Setup" = RM,
        tabledata "CGR Vehicle" = RM,
        tabledata "CGR Damage Entry" = RI,
        tabledata "CGR Rental Contract" = RIM,
        tabledata "CGR Rental Ledger Entry" = R,
        codeunit "CGR Rental Mgt" = X,
        codeunit "CGR Fleet Mgt" = X,
        codeunit "CGR Damage Mgt" = X,
        codeunit "CGR Core Events" = X;
}

permissionset 70481 "CGR BACKOFFICE"
{
    Assignable = true;
    Caption = 'CGR back office';
    Permissions =
        tabledata "CGR Setup" = R,
        tabledata "CGR Vehicle" = R,
        tabledata "CGR Rental Contract" = RM,
        tabledata "CGR Rental Ledger Entry" = RI,
        codeunit "CGR Rental Mgt" = X,
        codeunit "CGR Rental-Post" = X,
        codeunit "CGR Rental-Post Ledger" = X,
        codeunit "CGR Rental Pricing" = X;
}
