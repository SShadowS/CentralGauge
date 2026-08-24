permissionset 70603 "CG X095 Doc User"
{
    Assignable = true;
    Access = Public;
    Caption = 'CG X095 Doc User';

    Permissions = tabledata "CG X095 Document" = RIMD,
                  tabledata "CG X095 Doc Archive" = RIMD;
}
