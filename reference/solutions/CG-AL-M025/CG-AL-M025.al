codeunit 70125 "CG Bulk Data Manager"
{
    Access = Public;

    procedure InsertRecords(Count: Integer)
    var
        CGBulkTest: Record "CG Bulk Test";
        i: Integer;
    begin
        for i := 1 to Count do begin
            CGBulkTest.Init();
            CGBulkTest."Entry No." := i;
            CGBulkTest.Description := StrSubstNo('Record %1', i);
            CGBulkTest.Amount := i * 10;
            CGBulkTest.Insert();
        end;
    end;

    procedure TruncateAll()
    var
        CGBulkTest: Record "CG Bulk Test";
    begin
        CGBulkTest.Truncate();
    end;

    procedure GetRecordCount(): Integer
    var
        CGBulkTest: Record "CG Bulk Test";
    begin
        exit(CGBulkTest.Count());
    end;

    procedure InsertAndTruncate(Count: Integer): Integer
    begin
        InsertRecords(Count);
        TruncateAll();
        exit(GetRecordCount());
    end;

    procedure TruncateWithRecordRef(TableId: Integer)
    var
        RecRef: RecordRef;
    begin
        RecRef.Open(TableId);
        RecRef.Truncate();
        RecRef.Close();
    end;
}