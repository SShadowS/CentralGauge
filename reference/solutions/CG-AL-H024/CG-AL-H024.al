codeunit 70224 "CG Named Field Accessor"
{
    Access = Public;

    procedure GetFieldByName(RecRef: RecordRef; FieldName: Text): Text
    var
        FldRef: FieldRef;
    begin
        if FindFieldByName(RecRef, FieldName, FldRef) then
            exit(Format(FldRef.Value()));

        exit('');
    end;

    procedure FieldExistsByName(RecRef: RecordRef; FieldName: Text): Boolean
    var
        FldRef: FieldRef;
    begin
        exit(FindFieldByName(RecRef, FieldName, FldRef));
    end;

    procedure SetFieldByName(var RecRef: RecordRef; FieldName: Text; NewValue: Variant)
    var
        FldRef: FieldRef;
    begin
        if FindFieldByName(RecRef, FieldName, FldRef) then
            FldRef.Value(NewValue);
    end;

    procedure CopyFieldsByName(SourceRecRef: RecordRef; var DestRecRef: RecordRef; FieldNames: List of [Text])
    var
        SourceFldRef: FieldRef;
        DestFldRef: FieldRef;
        FieldName: Text;
    begin
        foreach FieldName in FieldNames do
            if FindFieldByName(SourceRecRef, FieldName, SourceFldRef) then
                if FindFieldByName(DestRecRef, FieldName, DestFldRef) then
                    DestFldRef.Value(SourceFldRef.Value());
    end;

    procedure GetAllFieldNames(RecRef: RecordRef): List of [Text]
    var
        FldRef: FieldRef;
        FieldNames: List of [Text];
        i: Integer;
    begin
        for i := 1 to RecRef.FieldCount() do begin
            FldRef := RecRef.FieldIndex(i);
            FieldNames.Add(FldRef.Name());
        end;

        exit(FieldNames);
    end;

    procedure BuildFieldMap(RecRef: RecordRef): Dictionary of [Text, Text]
    var
        FldRef: FieldRef;
        FieldMap: Dictionary of [Text, Text];
        i: Integer;
    begin
        for i := 1 to RecRef.FieldCount() do begin
            FldRef := RecRef.FieldIndex(i);
            FieldMap.Set(FldRef.Name(), Format(FldRef.Value()));
        end;

        exit(FieldMap);
    end;

    local procedure FindFieldByName(RecRef: RecordRef; FieldName: Text; var FldRef: FieldRef): Boolean
    var
        i: Integer;
    begin
        for i := 1 to RecRef.FieldCount() do begin
            FldRef := RecRef.FieldIndex(i);
            if FldRef.Name() = FieldName then
                exit(true);
        end;

        exit(false);
    end;
}