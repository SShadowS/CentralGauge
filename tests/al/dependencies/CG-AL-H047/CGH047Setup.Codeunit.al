codeunit 69471 "CG H047 Setup"
{
    Subtype = Install;

    trigger OnInstallAppPerCompany()
    var
        OrderLine: Record "CG H047 Order Line";
    begin
        if OrderLine.Count > 0 then
            exit;

        InsertOne(1, 'C001');
        InsertOne(2, 'C002');
        InsertOne(3, 'C001');
        InsertOne(4, 'C003');
        InsertOne(5, 'C002');
        InsertOne(6, 'C001');
    end;

    local procedure InsertOne(LineNo: Integer; CustomerNo: Code[20])
    var
        OrderLine: Record "CG H047 Order Line";
    begin
        OrderLine.Init();
        OrderLine."Line No." := LineNo;
        OrderLine."Customer No." := CustomerNo;
        OrderLine.Insert();
    end;
}
