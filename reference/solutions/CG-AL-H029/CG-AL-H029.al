codeunit 70229 "CG H029 Binary Detector"
{
    Access = Public;

    procedure IsBinaryField(TableNo: Integer; FieldNo: Integer): Boolean
    var
        RecRef: RecordRef;
        FldRef: FieldRef;
        Result: Boolean;
    begin
        RecRef.Open(TableNo);
        if not RecRef.FieldExist(FieldNo) then begin
            RecRef.Close();
            exit(false);
        end;
        FldRef := RecRef.Field(FieldNo);
        Result := FldRef.Type in [FieldType::Blob, FieldType::Media, FieldType::MediaSet];
        RecRef.Close();
        exit(Result);
    end;

    procedure IsBlobField(TableNo: Integer; FieldNo: Integer): Boolean
    var
        RecRef: RecordRef;
        FldRef: FieldRef;
        Result: Boolean;
    begin
        RecRef.Open(TableNo);
        if not RecRef.FieldExist(FieldNo) then begin
            RecRef.Close();
            exit(false);
        end;
        FldRef := RecRef.Field(FieldNo);
        Result := FldRef.Type = FieldType::Blob;
        RecRef.Close();
        exit(Result);
    end;

    procedure GetFieldTypeAsText(TableNo: Integer; FieldNo: Integer): Text
    var
        RecRef: RecordRef;
        FldRef: FieldRef;
        Result: Text;
    begin
        RecRef.Open(TableNo);
        if not RecRef.FieldExist(FieldNo) then begin
            RecRef.Close();
            exit('');
        end;
        FldRef := RecRef.Field(FieldNo);
        Result := Format(FldRef.Type);
        RecRef.Close();
        exit(Result);
    end;

    procedure CountBinaryFields(TableNo: Integer): Integer
    var
        RecRef: RecordRef;
        FldRef: FieldRef;
        i: Integer;
        Count: Integer;
    begin
        RecRef.Open(TableNo);
        for i := 1 to RecRef.FieldCount() do begin
            FldRef := RecRef.FieldIndex(i);
            if FldRef.Type in [FieldType::Blob, FieldType::Media, FieldType::MediaSet] then
                Count += 1;
        end;
        RecRef.Close();
        exit(Count);
    end;

    procedure WriteBlobText(var RecRef: RecordRef; FieldNo: Integer; Content: Text): Boolean
    var
        TempBlob: Codeunit "Temp Blob";
        FldRef: FieldRef;
        OutStr: OutStream;
    begin
        FldRef := RecRef.Field(FieldNo);
        if FldRef.Type <> FieldType::Blob then
            exit(false);

        TempBlob.CreateOutStream(OutStr, TextEncoding::UTF8);
        OutStr.WriteText(Content);
        TempBlob.ToFieldRef(FldRef);
        RecRef.Modify();
        exit(true);
    end;

    procedure ReadBlobText(var RecRef: RecordRef; FieldNo: Integer): Text
    var
        TempBlob: Codeunit "Temp Blob";
        FldRef: FieldRef;
        InStr: InStream;
        Result: Text;
    begin
        FldRef := RecRef.Field(FieldNo);
        if FldRef.Type <> FieldType::Blob then
            exit('');

        FldRef.CalcField();
        TempBlob.FromFieldRef(FldRef);
        if not TempBlob.HasValue() then
            exit('');

        TempBlob.CreateInStream(InStr, TextEncoding::UTF8);
        InStr.ReadText(Result);
        exit(Result);
    end;

    procedure BlobHasContent(var RecRef: RecordRef; FieldNo: Integer): Boolean
    var
        TempBlob: Codeunit "Temp Blob";
        FldRef: FieldRef;
    begin
        FldRef := RecRef.Field(FieldNo);
        if FldRef.Type <> FieldType::Blob then
            exit(false);

        FldRef.CalcField();
        TempBlob.FromFieldRef(FldRef);
        exit(TempBlob.HasValue());
    end;
}