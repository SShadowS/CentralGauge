codeunit 70883 "CG X128 Treasury Rate"
{
    procedure SetIntercompanyRate(CurrencyCode: Code[10]; Rate: Decimal)
    var
        GroupRate: Record "CG X128 Group Rate";
    begin
        if not GroupRate.Get(CurrencyCode) then begin
            GroupRate.Init();
            GroupRate."Currency Code" := CurrencyCode;
            GroupRate.Insert();
        end;
        GroupRate."Intercompany Rate" := Rate;
        GroupRate.Modify();
    end;

    procedure GetIntercompanyRate(CurrencyCode: Code[10]): Decimal
    var
        GroupRate: Record "CG X128 Group Rate";
    begin
        if GroupRate.Get(CurrencyCode) then
            exit(GroupRate."Intercompany Rate");
        exit(0);
    end;
}
