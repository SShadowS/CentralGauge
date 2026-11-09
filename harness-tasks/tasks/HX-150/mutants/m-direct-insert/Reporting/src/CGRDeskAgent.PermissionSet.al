permissionset 70575 "CGR DESK AGENT"
{
    Assignable = true;
    Caption = 'CGR desk agent';
    Permissions =
        tabledata "CGR Setup" = RM,
        tabledata "CGR Vehicle" = RM,
        tabledata "CGR Rental Contract" = RIM,
        tabledata "CGR Rental Ledger Entry" = RI,
        table "CGR Rental Ledger Entry" = X,
        codeunit "CGR Rental Mgt" = X,
        codeunit "CGR Rental-Post" = X,
        codeunit "CGR Rental-Post Ledger" = X,
        codeunit "CGR Rental Pricing" = X;
}
