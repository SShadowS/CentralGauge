codeunit 69491 "CG H049 Setup"
{
    Subtype = Install;

    trigger OnInstallAppPerCompany()
    begin
        SeedRows();
    end;

    local procedure SeedRows()
    var
        Line: Record "CG H049 Sale Line";
    begin
        if not Line.IsEmpty() then
            exit;

        Insert(Line, 1, 'D1', 10);
        Insert(Line, 2, 'D1', 20);
        Insert(Line, 3, 'D1', 30);
        Insert(Line, 4, 'D2', 100);
        Insert(Line, 5, 'D2', 200);
    end;

    local procedure Insert(var Line: Record "CG H049 Sale Line"; EntryNo: Integer; DocNo: Code[20]; Amount: Decimal)
    begin
        Line.Init();
        Line."Entry No." := EntryNo;
        Line."Doc No." := DocNo;
        Line."Amount" := Amount;
        Line.Insert();
    end;
}
