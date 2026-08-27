interface "IFieldTransformer"
{
    procedure Transform(var FieldRef: FieldRef): Variant;
}

codeunit 70226 "CG Record Introspector"
{
    Access = Public;

    procedure SerializeToJson(SourceRecord: Variant): JsonObject
    var
        RecRef: RecordRef;
        FldRef: FieldRef;
        ResultJson: JsonObject;
        MetadataJson: JsonObject;
        i: Integer;
    begin
        if not SourceRecord.IsRecord() then
            exit(ResultJson);

        RecRef.GetTable(SourceRecord);

        for i := 1 to RecRef.FieldCount() do begin
            FldRef := RecRef.FieldIndex(i);
            if not (FldRef.Type() in [FieldType::BLOB, FieldType::Media, FieldType::MediaSet]) then
                AddFieldToJson(ResultJson, FldRef);
        end;

        MetadataJson.Add('TableName', RecRef.Name());
        MetadataJson.Add('TableId', RecRef.Number());
        MetadataJson.Add('RecordId', Format(RecRef.RecordId()));
        ResultJson.Add('_metadata', MetadataJson);

        exit(ResultJson);
    end;

    local procedure AddFieldToJson(var JsonObj: JsonObject; FldRef: FieldRef)
    var
        TxtVal: Text;
        IntVal: Integer;
        DecVal: Decimal;
        BoolVal: Boolean;
        DateVal: Date;
        DateTimeVal: DateTime;
    begin
        case FldRef.Type() of
            FieldType::Text, FieldType::Code:
                begin
                    TxtVal := Format(FldRef.Value());
                    JsonObj.Add(FldRef.Name(), TxtVal);
                end;
            FieldType::Integer, FieldType::BigInteger:
                begin
                    IntVal := FldRef.Value();
                    JsonObj.Add(FldRef.Name(), IntVal);
                end;
            FieldType::Decimal:
                begin
                    DecVal := FldRef.Value();
                    JsonObj.Add(FldRef.Name(), DecVal);
                end;
            FieldType::Boolean:
                begin
                    BoolVal := FldRef.Value();
                    JsonObj.Add(FldRef.Name(), BoolVal);
                end;
            FieldType::Date:
                begin
                    DateVal := FldRef.Value();
                    JsonObj.Add(FldRef.Name(), Format(DateVal, 0, 9));
                end;
            FieldType::DateTime:
                begin
                    DateTimeVal := FldRef.Value();
                    JsonObj.Add(FldRef.Name(), Format(DateTimeVal, 0, 9));
                end;
            FieldType::Option:
                begin
                    IntVal := FldRef.Value();
                    JsonObj.Add(FldRef.Name(), IntVal);
                end;
            else
                JsonObj.Add(FldRef.Name(), Format(FldRef.Value(), 0, 9));
        end;
    end;

    procedure DeserializeFromJson(JsonData: JsonObject; var DestRecRef: RecordRef): Boolean
    var
        FldRef: FieldRef;
        MetadataToken: JsonToken;
        TableIdToken: JsonToken;
        PropToken: JsonToken;
        JsonKey: Text;
        FieldsSet: Integer;
        i: Integer;
    begin
        if JsonData.Get('_metadata', MetadataToken) then
            if MetadataToken.AsObject().Get('TableId', TableIdToken) then
                if TableIdToken.AsValue().AsInteger() <> DestRecRef.Number() then
                    exit(false);

        foreach JsonKey in JsonData.Keys() do begin
            if JsonKey <> '_metadata' then begin
                for i := 1 to DestRecRef.FieldCount() do begin
                    FldRef := DestRecRef.FieldIndex(i);
                    if FldRef.Name() = JsonKey then begin
                        JsonData.Get(JsonKey, PropToken);
                        if SetFieldFromJsonToken(FldRef, PropToken) then
                            FieldsSet += 1;
                        break;
                    end;
                end;
            end;
        end;

        exit(FieldsSet > 0);
    end;

    local procedure SetFieldFromJsonToken(var FldRef: FieldRef; JsonToken: JsonToken): Boolean
    var
        JsonValue: JsonValue;
        TxtVal: Text;
        DateVal: Date;
        DateTimeVal: DateTime;
    begin
        if not JsonToken.IsValue() then
            exit(false);

        JsonValue := JsonToken.AsValue();
        if JsonValue.IsNull() then
            exit(false);

        case FldRef.Type() of
            FieldType::Text, FieldType::Code:
                begin
                    TxtVal := JsonValue.AsText();
                    FldRef.Value := TxtVal;
                end;
            FieldType::Integer:
                FldRef.Value := JsonValue.AsInteger();
            FieldType::BigInteger:
                FldRef.Value := JsonValue.AsBigInteger();
            FieldType::Decimal:
                FldRef.Value := JsonValue.AsDecimal();
            FieldType::Boolean:
                FldRef.Value := JsonValue.AsBoolean();
            FieldType::Date:
                begin
                    if Evaluate(DateVal, JsonValue.AsText(), 9) then
                        FldRef.Value := DateVal;
                end;
            FieldType::DateTime:
                begin
                    if Evaluate(DateTimeVal, JsonValue.AsText(), 9) then
                        FldRef.Value := DateTimeVal;
                end;
            FieldType::Option:
                FldRef.Value := JsonValue.AsInteger();
            else
                FldRef.Value := JsonValue.AsText();
        end;
        exit(true);
    end;

    procedure CompareRecords(Record1: Variant; Record2: Variant) Differences: Dictionary of [Text, Text]
    var
        RecRef1: RecordRef;
        RecRef2: RecordRef;
        FldRef1: FieldRef;
        FldRef2: FieldRef;
        Val1: Text;
        Val2: Text;
        i: Integer;
    begin
        if not Record1.IsRecord() or not Record2.IsRecord() then
            exit;

        RecRef1.GetTable(Record1);
        RecRef2.GetTable(Record2);

        if RecRef1.Number() <> RecRef2.Number() then
            exit;

        for i := 1 to RecRef1.FieldCount() do begin
            FldRef1 := RecRef1.FieldIndex(i);
            FldRef2 := RecRef2.FieldIndex(i);

            if (FldRef1.Class() = FieldClass::Normal) and not (FldRef1.Type() in [FieldType::BLOB, FieldType::Media, FieldType::MediaSet]) then begin
                Val1 := Format(FldRef1.Value());
                Val2 := Format(FldRef2.Value());
                if Val1 <> Val2 then
                    Differences.Add(FldRef1.Name(), '[' + Val1 + '] -> [' + Val2 + ']');
            end;
        end;
    end;

    procedure CloneRecord(SourceRecord: Variant; var DestRecRef: RecordRef): Boolean
    var
        SourceRecRef: RecordRef;
        SourceFldRef: FieldRef;
        DestFldRef: FieldRef;
        KeyRef: KeyRef;
        PKHasValue: Boolean;
        PKFieldNos: List of [Integer];
        i: Integer;
        FldNo: Integer;
    begin
        if not SourceRecord.IsRecord() then
            exit(false);

        SourceRecRef.GetTable(SourceRecord);
        if SourceRecRef.Number() <> DestRecRef.Number() then
            exit(false);

        KeyRef := DestRecRef.KeyIndex(1);
        for i := 1 to KeyRef.FieldCount() do begin
            DestFldRef := KeyRef.FieldIndex(i);
            PKFieldNos.Add(DestFldRef.Number());
            if Format(DestFldRef.Value()) <> Format(GetDefaultValue(DestFldRef.Type())) then
                PKHasValue := true;
        end;

        for i := 1 to SourceRecRef.FieldCount() do begin
            SourceFldRef := SourceRecRef.FieldIndex(i);
            if (SourceFldRef.Class() = FieldClass::Normal) and not (SourceFldRef.Type() in [FieldType::BLOB, FieldType::Media, FieldType::MediaSet]) then begin
                FldNo := SourceFldRef.Number();
                if PKHasValue and PKFieldNos.Contains(FldNo) then begin
                    // keep destination PK
                end else begin
                    DestFldRef := DestRecRef.Field(FldNo);
                    DestFldRef.Value := SourceFldRef.Value();
                end;
            end;
        end;
        exit(true);
    end;

    local procedure GetDefaultValue(FType: FieldType): Text
    begin
        case FType of
            FieldType::Integer, FieldType::Decimal, FieldType::BigInteger, FieldType::Option:
                exit('0');
            FieldType::Date:
                exit(Format(0D));
            else
                exit('');
        end;
    end;

    procedure GetTableSchema(TableId: Integer): JsonArray
    var
        RecRef: RecordRef;
        FldRef: FieldRef;
        KeyRef: KeyRef;
        ResultArray: JsonArray;
        FieldJson: JsonObject;
        PKFields: List of [Integer];
        i: Integer;
        FldClassTxt: Text;
    begin
        if TableId = 0 then
            exit(ResultArray);

        RecRef.Open(TableId);
        KeyRef := RecRef.KeyIndex(1);
        for i := 1 to KeyRef.FieldCount() do
            PKFields.Add(KeyRef.FieldIndex(i).Number());

        for i := 1 to RecRef.FieldCount() do begin
            FldRef := RecRef.FieldIndex(i);
            Clear(FieldJson);
            FieldJson.Add('FieldNo', FldRef.Number());
            FieldJson.Add('FieldName', FldRef.Name());
            FieldJson.Add('FieldType', Format(FldRef.Type()));
            FieldJson.Add('Length', FldRef.Length());
            case FldRef.Class() of
                FieldClass::Normal:
                    FldClassTxt := 'Normal';
                FieldClass::FlowField:
                    FldClassTxt := 'FlowField';
                FieldClass::FlowFilter:
                    FldClassTxt := 'FlowFilter';
            end;
            FieldJson.Add('FieldClass', FldClassTxt);
            FieldJson.Add('RelatedTable', FldRef.Relation());
            FieldJson.Add('IsPartOfPrimaryKey', PKFields.Contains(FldRef.Number()));
            ResultArray.Add(FieldJson);
        end;
        RecRef.Close();
        exit(ResultArray);
    end;

    procedure BuildDynamicFilter(var RecRef: RecordRef; FilterCriteria: Dictionary of [Text, Text]): Boolean
    var
        FldRef: FieldRef;
        FieldName: Text;
        FilterValue: Text;
        Found: Boolean;
        i: Integer;
    begin
        foreach FieldName in FilterCriteria.Keys() do begin
            Found := false;
            for i := 1 to RecRef.FieldCount() do begin
                FldRef := RecRef.FieldIndex(i);
                if FldRef.Name() = FieldName then begin
                    FilterCriteria.Get(FieldName, FilterValue);
                    FldRef.SetFilter(FilterValue);
                    Found := true;
                    break;
                end;
            end;
            if not Found then
                exit(false);
        end;
        exit(true);
    end;

    procedure GetRecordByPrimaryKey(TableId: Integer; KeyValues: List of [Text]; var ResultRecRef: RecordRef): Boolean
    var
        KeyRef: KeyRef;
        FldRef: FieldRef;
        i: Integer;
        KeyVal: Text;
    begin
        ResultRecRef.Open(TableId);
        KeyRef := ResultRecRef.KeyIndex(1);

        if KeyValues.Count() > KeyRef.FieldCount() then
            exit(false);

        for i := 1 to KeyValues.Count() do begin
            FldRef := KeyRef.FieldIndex(i);
            KeyValues.Get(i, KeyVal);
            FldRef.SetFilter(KeyVal);
        end;

        exit(ResultRecRef.FindFirst());
    end;

    procedure TransformRecord(var RecRef: RecordRef; Transformer: Interface "IFieldTransformer"): Integer
    var
        FldRef: FieldRef;
        OldVal: Variant;
        NewVal: Variant;
        Count: Integer;
        i: Integer;
    begin
        for i := 1 to RecRef.FieldCount() do begin
            FldRef := RecRef.FieldIndex(i);
            if (FldRef.Class() = FieldClass::Normal) and not (FldRef.Type() in [FieldType::BLOB, FieldType::Media, FieldType::MediaSet]) then begin
                OldVal := FldRef.Value();
                NewVal := Transformer.Transform(FldRef);
                if Format(NewVal) <> Format(OldVal) then begin
                    FldRef.Value := NewVal;
                    Count += 1;
                end;
            end;
        end;
        exit(Count);
    end;

    procedure FindRelatedRecords(SourceRecRef: RecordRef; RelatedTableId: Integer): List of [RecordId]
    var
        RelatedRecRef: RecordRef;
        FldRef: FieldRef;
        SourcePKFldRef: FieldRef;
        SourceKeyRef: KeyRef;
        ResultList: List of [RecordId];
        i: Integer;
    begin
        RelatedRecRef.Open(RelatedTableId);
        SourceKeyRef := SourceRecRef.KeyIndex(1);
        if SourceKeyRef.FieldCount() < 1 then begin
            RelatedRecRef.Close();
            exit(ResultList);
        end;
        SourcePKFldRef := SourceKeyRef.FieldIndex(1);

        for i := 1 to RelatedRecRef.FieldCount() do begin
            FldRef := RelatedRecRef.FieldIndex(i);
            if FldRef.Relation() = SourceRecRef.Number() then begin
                RelatedRecRef.Reset();
                FldRef.SetRange(SourcePKFldRef.Value());
                if RelatedRecRef.FindSet() then
                    repeat
                        ResultList.Add(RelatedRecRef.RecordId());
                    until RelatedRecRef.Next() = 0;
            end;
        end;
        RelatedRecRef.Close();
        exit(ResultList);
    end;

    procedure ValidateRecordCompleteness(RecRef: RecordRef; RequiredFieldNos: List of [Integer]): List of [Text]
    var
        FldRef: FieldRef;
        EmptyFields: List of [Text];
        FldNo: Integer;
        TxtVal: Text;
        IntVal: Integer;
        DecVal: Decimal;
        DateVal: Date;
    begin
        foreach FldNo in RequiredFieldNos do begin
            FldRef := RecRef.Field(FldNo);
            case FldRef.Type() of
                FieldType::Text, FieldType::Code:
                    begin
                        TxtVal := Format(FldRef.Value());
                        if TxtVal = '' then
                            EmptyFields.Add(FldRef.Name());
                    end;
                FieldType::Integer, FieldType::BigInteger, FieldType::Option:
                    begin
                        IntVal := FldRef.Value();
                        if IntVal = 0 then
                            EmptyFields.Add(FldRef.Name());
                    end;
                FieldType::Decimal:
                    begin
                        DecVal := FldRef.Value();
                        if DecVal = 0 then
                            EmptyFields.Add(FldRef.Name());
                    end;
                FieldType::Date:
                    begin
                        DateVal := FldRef.Value();
                        if DateVal = 0D then
                            EmptyFields.Add(FldRef.Name());
                    end;
                FieldType::Boolean:
                    ;
            end;
        end;
        exit(EmptyFields);
    end;
}