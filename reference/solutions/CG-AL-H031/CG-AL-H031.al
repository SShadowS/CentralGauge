codeunit 70231 "CG H031 FlowField Calc"
{
    Access = Public;

    procedure GetFieldClassText(TableNo: Integer; FieldNo: Integer): Text
    var
        RecRef: RecordRef;
        FldRef: FieldRef;
        ClassText: Text;
    begin
        ClassText := '';
        RecRef.Open(TableNo);
        if RecRef.FieldExist(FieldNo) then begin
            FldRef := RecRef.Field(FieldNo);
            ClassText := Format(FldRef.Class);
        end;
        RecRef.Close();
        exit(ClassText);
    end;

    procedure IsFlowField(TableNo: Integer; FieldNo: Integer): Boolean
    var
        RecRef: RecordRef;
        FldRef: FieldRef;
        Result: Boolean;
    begin
        Result := false;
        RecRef.Open(TableNo);
        if RecRef.FieldExist(FieldNo) then begin
            FldRef := RecRef.Field(FieldNo);
            Result := FldRef.Class = FieldClass::FlowField;
        end;
        RecRef.Close();
        exit(Result);
    end;

    procedure CalcIfFlowField(var RecRef: RecordRef; FieldNo: Integer): Boolean
    var
        FldRef: FieldRef;
    begin
        if not RecRef.FieldExist(FieldNo) then
            exit(false);

        FldRef := RecRef.Field(FieldNo);
        if FldRef.Class <> FieldClass::FlowField then
            exit(false);

        FldRef.CalcField();
        exit(true);
    end;

    procedure GetCalculatedDecimal(var RecRef: RecordRef; FieldNo: Integer): Decimal
    var
        FldRef: FieldRef;
        ValueVariant: Variant;
        Result: Decimal;
    begin
        if not RecRef.FieldExist(FieldNo) then
            exit(0);

        CalcIfFlowField(RecRef, FieldNo);

        FldRef := RecRef.Field(FieldNo);
        ValueVariant := FldRef.Value();

        Result := 0;
        if ValueVariant.IsDecimal() then
            Result := ValueVariant
        else
            if ValueVariant.IsInteger() then
                Result := ValueVariant
            else
                if ValueVariant.IsBigInteger() then
                    Result := ValueVariant;

        exit(Result);
    end;

    procedure IsFlowFilter(TableNo: Integer; FieldNo: Integer): Boolean
    var
        RecRef: RecordRef;
        FldRef: FieldRef;
        Result: Boolean;
    begin
        Result := false;
        RecRef.Open(TableNo);
        if RecRef.FieldExist(FieldNo) then begin
            FldRef := RecRef.Field(FieldNo);
            Result := FldRef.Class = FieldClass::FlowFilter;
        end;
        RecRef.Close();
        exit(Result);
    end;

    procedure GetClassOrdinal(TableNo: Integer; FieldNo: Integer): Integer
    var
        RecRef: RecordRef;
        FldRef: FieldRef;
        Result: Integer;
    begin
        Result := -1;
        RecRef.Open(TableNo);
        if RecRef.FieldExist(FieldNo) then begin
            FldRef := RecRef.Field(FieldNo);
            case FldRef.Class of
                FieldClass::Normal:
                    Result := 0;
                FieldClass::FlowField:
                    Result := 1;
                FieldClass::FlowFilter:
                    Result := 2;
            end;
        end;
        RecRef.Close();
        exit(Result);
    end;

    procedure SumFieldByFilter(TableNo: Integer; FilterFieldNo: Integer; FilterValue: Variant; SumFieldNo: Integer): Decimal
    var
        RecRef: RecordRef;
        FilterFldRef: FieldRef;
        Total: Decimal;
    begin
        Total := 0;
        RecRef.Open(TableNo);
        FilterFldRef := RecRef.Field(FilterFieldNo);
        FilterFldRef.SetRange(FilterValue);
        if RecRef.FindSet() then
            repeat
                Total += GetCalculatedDecimal(RecRef, SumFieldNo);
            until RecRef.Next() = 0;
        RecRef.Close();
        exit(Total);
    end;
}