codeunit 71070 "CG X018 Roller"
{
    Access = Internal;

    procedure SumForGroup(GroupCode: Code[20]): Integer
    var
        CGX018Group: Record "CG X018 Group";
        CGX018Entry: Record "CG X018 Entry";
    begin
        CGX018Group.Get(GroupCode);

        if CGX018Group.Totaling = '' then
            exit(0);

        CGX018Entry.SetFilter("Account No.", CGX018Group.Totaling);
        CGX018Entry.CalcSums(Amount);
        exit(CGX018Entry.Amount);
    end;
}