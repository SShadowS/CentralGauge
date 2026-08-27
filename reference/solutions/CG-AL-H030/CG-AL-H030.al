codeunit 70230 "CG H030 PK Serializer"
{
    Access = Public;

    procedure CountKeyFields(TableNo: Integer): Integer
    var
        RecRef: RecordRef;
        PKRef: KeyRef;
        FieldCnt: Integer;
    begin
        if not TryOpenTable(RecRef, TableNo) then
            exit(0);

        PKRef := RecRef.KeyIndex(1);
        FieldCnt := PKRef.FieldCount;
        RecRef.Close();
        exit(FieldCnt);
    end;

    procedure SerializePrimaryKey(var RecRef: RecordRef): Text
    var
        PKRef: KeyRef;
        FldRef: FieldRef;
        Result: Text;
        i: Integer;
    begin
        PKRef := RecRef.KeyIndex(1);
        for i := 1 to PKRef.FieldCount do begin
            FldRef := PKRef.FieldIndex(i);
            if i > 1 then
                Result += '|';
            Result += Format(FldRef.Value, 0, 9);
        end;
        exit(Result);
    end;

    procedure GetByPrimaryKey(TableNo: Integer; KeyText: Text; var ResultRecRef: RecordRef): Boolean
    var
        PKRef: KeyRef;
        FldRef: FieldRef;
        Pieces: List of [Text];
        i: Integer;
    begin
        ResultRecRef.Open(TableNo);
        PKRef := ResultRecRef.KeyIndex(1);

        Pieces := KeyText.Split('|');
        if Pieces.Count <> PKRef.FieldCount then
            exit(false);

        for i := 1 to PKRef.FieldCount do begin
            FldRef := PKRef.FieldIndex(i);
            Evaluate(FldRef, Pieces.Get(i), 9);
        end;

        exit(ResultRecRef.Find('='));
    end;

    procedure GetNthKeyFieldName(TableNo: Integer; KeyIdx: Integer; FieldIdx: Integer): Text
    var
        RecRef: RecordRef;
        KRef: KeyRef;
        FldRef: FieldRef;
        FieldName: Text;
    begin
        RecRef.Open(TableNo);

        if KeyIdx > RecRef.KeyCount then begin
            RecRef.Close();
            exit('');
        end;

        KRef := RecRef.KeyIndex(KeyIdx);
        if FieldIdx > KRef.FieldCount then begin
            RecRef.Close();
            exit('');
        end;

        FldRef := KRef.FieldIndex(FieldIdx);
        FieldName := FldRef.Name;
        RecRef.Close();
        exit(FieldName);
    end;

    [TryFunction]
    local procedure TryOpenTable(var RecRef: RecordRef; TableNo: Integer)
    begin
        RecRef.Open(TableNo);
    end;
}