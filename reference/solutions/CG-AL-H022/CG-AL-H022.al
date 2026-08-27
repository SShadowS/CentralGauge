codeunit 70224 "CG Dynamic Record Handler"
{
    Access = Public;

    procedure GetTableName(TableId: Integer): Text
    var
        RecRef: RecordRef;
        TableName: Text;
    begin
        if not TryOpenTable(RecRef, TableId) then
            exit('');

        TableName := RecRef.Name;
        RecRef.Close();
        exit(TableName);
    end;

    procedure GetPrimaryKeyFieldCount(TableId: Integer): Integer
    var
        RecRef: RecordRef;
        KeyRef: KeyRef;
        FieldCount: Integer;
    begin
        if not TryOpenTable(RecRef, TableId) then
            exit(0);

        if RecRef.KeyCount() = 0 then begin
            RecRef.Close();
            exit(0);
        end;

        KeyRef := RecRef.KeyIndex(1);
        FieldCount := KeyRef.FieldCount();
        RecRef.Close();
        exit(FieldCount);
    end;

    procedure GetFieldValueAsText(var RecRef: RecordRef; FieldNo: Integer): Text
    var
        FldRef: FieldRef;
    begin
        if not RecRef.FieldExist(FieldNo) then
            exit('');

        FldRef := RecRef.Field(FieldNo);
        exit(Format(FldRef.Value));
    end;

    procedure SetFieldValue(var RecRef: RecordRef; FieldNo: Integer; NewValue: Variant): Boolean
    var
        FldRef: FieldRef;
    begin
        if not RecRef.FieldExist(FieldNo) then
            exit(false);

        FldRef := RecRef.Field(FieldNo);
        FldRef.Value := NewValue;
        exit(true);
    end;

    procedure CopyMatchingFields(SourceRecRef: RecordRef; var DestRecRef: RecordRef): Integer
    var
        SourceFldRef: FieldRef;
        DestFldRef: FieldRef;
        SourceIndex: Integer;
        DestIndex: Integer;
        CopiedCount: Integer;
    begin
        CopiedCount := 0;

        for SourceIndex := 1 to SourceRecRef.FieldCount() do begin
            SourceFldRef := SourceRecRef.FieldIndex(SourceIndex);
            for DestIndex := 1 to DestRecRef.FieldCount() do begin
                DestFldRef := DestRecRef.FieldIndex(DestIndex);
                if DestFldRef.Name = SourceFldRef.Name then begin
                    DestFldRef.Value := SourceFldRef.Value;
                    CopiedCount += 1;
                end;
            end;
        end;

        exit(CopiedCount);
    end;

    procedure GetFilterString(var RecRef: RecordRef): Text
    begin
        exit(RecRef.GetFilters());
    end;

    procedure ApplyFilterString(var RecRef: RecordRef; FilterText: Text): Boolean
    begin
        exit(TrySetView(RecRef, FilterText));
    end;

    procedure GetRelatedTableId(TableId: Integer; FieldNo: Integer): Integer
    var
        RecRef: RecordRef;
        FldRef: FieldRef;
        RelatedTableId: Integer;
    begin
        if not TryOpenTable(RecRef, TableId) then
            exit(0);

        if not RecRef.FieldExist(FieldNo) then begin
            RecRef.Close();
            exit(0);
        end;

        FldRef := RecRef.Field(FieldNo);
        RelatedTableId := FldRef.Relation();
        RecRef.Close();
        exit(RelatedTableId);
    end;

    [TryFunction]
    local procedure TryOpenTable(var RecRef: RecordRef; TableId: Integer)
    begin
        RecRef.Open(TableId);
    end;

    [TryFunction]
    local procedure TrySetView(var RecRef: RecordRef; FilterText: Text)
    begin
        RecRef.SetView(FilterText);
    end;
}