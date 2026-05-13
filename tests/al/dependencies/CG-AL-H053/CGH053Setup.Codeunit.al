codeunit 69531 "CG H053 Setup"
{
    Subtype = Install;

    trigger OnInstallAppPerCompany()
    begin
        Seed();
    end;

    local procedure Seed()
    var
        S: Record "CG H053 Sale";
    begin
        if not S.IsEmpty() then
            exit;
        Insert(S, 1, 'C001', 100);
        Insert(S, 2, 'C001', 200);
        Insert(S, 3, 'C001', 300);
        Insert(S, 4, 'C002', 50);
        Insert(S, 5, 'C002', 75);
        Insert(S, 6, 'C003', 1000);
    end;

    local procedure Insert(var S: Record "CG H053 Sale"; EntryNo: Integer; Cust: Code[20]; Amt: Decimal)
    begin
        S.Init();
        S."Entry No." := EntryNo;
        S."Customer No." := Cust;
        S."Amount" := Amt;
        S.Insert();
    end;
}
