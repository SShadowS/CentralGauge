permissionset 71484 "CG X164 Clerk"
{
    Assignable = true;
    Access = Public;
    Caption = 'CG X164 Clerk';

    Permissions = tabledata "CG X164 Request" = RIMD,
                  tabledata "CG X164 Usage Trace" = R;
}
