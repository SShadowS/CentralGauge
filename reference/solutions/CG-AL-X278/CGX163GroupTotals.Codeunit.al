codeunit 71473 "CG X163 Group Totals"
{
    procedure GetGroupTotal(AccountCode: Code[20]): Decimal
    var
        Company: Record Company;
        GroupTotal: Decimal;
    begin
        if Company.FindSet() then
            repeat
                GroupTotal += SumAccountIn(Company.Name, AccountCode);
            until Company.Next() = 0;
        exit(GroupTotal);
    end;

    local procedure SumAccountIn(ForCompany: Text[30]; AccountCode: Code[20]): Decimal
    var
        Ledger: Record "CG X163 Branch Ledger";
        QueryLog: Record "CG X163 Query Log";
        LineTotal: Decimal;
    begin
        Ledger.ChangeCompany(ForCompany);
        Ledger.SetRange("Account Code", AccountCode);
        if Ledger.FindSet() then
            repeat
                LineTotal += Ledger.Amount;
            until Ledger.Next() = 0;

        QueryLog.Init();
        QueryLog."Company Name" := ForCompany;
        QueryLog."Account Code" := AccountCode;
        QueryLog.Insert(true);

        exit(LineTotal);
    end;
}
