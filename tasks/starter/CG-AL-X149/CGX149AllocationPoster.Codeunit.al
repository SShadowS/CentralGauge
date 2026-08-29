codeunit 71333 "CG X149 Allocation Poster"
{
    procedure PostAllocations(DocumentNo: Code[20])
    var
        Line: Record "CG X149 Allocation Line";
        RawTotal: Decimal;
        PostedTotal: Decimal;
        Remainder: Decimal;
    begin
        Line.SetRange("Document No.", DocumentNo);
        if Line.FindSet() then
            repeat
                RawTotal += Line.Amount;
                PostedTotal += PostLine(Line);
            until Line.Next() = 0;

        Remainder := Round(RawTotal, 1) - PostedTotal;
        if Remainder <> 0 then
            PostRemainder(DocumentNo, Remainder);
    end;

    procedure GetHeaderDepartment(DocumentNo: Code[20]): Code[10]
    var
        Header: Record "CG X149 Allocation Header";
    begin
        if not Header.Get(DocumentNo) then
            exit('');
        exit(Header."Department Code");
    end;

    local procedure PostLine(var Line: Record "CG X149 Allocation Line"): Decimal
    var
        RoundedAmount: Decimal;
    begin
        RoundedAmount := Round(Line.Amount, 1);
        InsertEntry(Line."Document No.", Line."Line No.", Line."Department Code", RoundedAmount);
        exit(RoundedAmount);
    end;

    local procedure PostRemainder(DocumentNo: Code[20]; RemainderAmount: Decimal)
    begin
        InsertEntry(DocumentNo, 0, '', RemainderAmount);
    end;

    local procedure InsertEntry(DocumentNo: Code[20]; LineNo: Integer; DepartmentCode: Code[10]; EntryAmount: Decimal)
    var
        Entry: Record "CG X149 Allocation Entry";
    begin
        if DepartmentCode = '' then
            Error('Department Code must be specified for document %1 line %2.', DocumentNo, LineNo);

        Entry.Init();
        Entry."Document No." := DocumentNo;
        Entry."Line No." := LineNo;
        Entry."Department Code" := DepartmentCode;
        Entry.Amount := EntryAmount;
        Entry.Insert(true);
    end;
}
