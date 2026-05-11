codeunit 69451 "CG H045 Setup"
{
    Subtype = Install;

    trigger OnInstallAppPerCompany()
    var
        Entry: Record "CG H045 Entry";
    begin
        if Entry.Count > 0 then
            exit;

        InsertOne(1, 'D1', 0, false);
        InsertOne(2, 'D1', 0, false);
        InsertOne(3, 'D1', 0, false);
        InsertOne(4, 'D2', 5, true);
        InsertOne(5, 'D2', 5, true);
    end;

    local procedure InsertOne(EntryNo: Integer; DocNo: Code[20]; Tol: Decimal; Accepted: Boolean)
    var
        Entry: Record "CG H045 Entry";
    begin
        Entry.Init();
        Entry."Entry No." := EntryNo;
        Entry."Doc No." := DocNo;
        Entry.Tolerance := Tol;
        Entry."Accepted Flag" := Accepted;
        Entry.Insert();
    end;
}
