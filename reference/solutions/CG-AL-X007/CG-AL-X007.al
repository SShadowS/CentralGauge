codeunit 70960 "CG X007 Summer"
{
    Access = Internal;

    procedure SumAcrossCompanies(Companies: List of [Text[30]]): Integer
    var
        CGX007Entry: Record "CG X007 Entry";
        CompanyName: Text[30];
        Total: Integer;
    begin
        Total := 0;
        foreach CompanyName in Companies do begin
            CGX007Entry.Reset();
            CGX007Entry.ChangeCompany(CompanyName);
            CGX007Entry.CalcSums(Amount);
            Total += CGX007Entry.Amount;
        end;
        exit(Total);
    end;
}