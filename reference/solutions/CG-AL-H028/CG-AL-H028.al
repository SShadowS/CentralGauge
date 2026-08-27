codeunit 70228 "CG H028 FieldRef Filter"
{
    Access = Public;

    procedure CountWhereFieldEquals(TableNo: Integer; FieldNo: Integer; FilterValue: Variant): Integer
    var
        RecRef: RecordRef;
        FldRef: FieldRef;
        ResultCount: Integer;
    begin
        RecRef.Open(TableNo);
        FldRef := RecRef.Field(FieldNo);
        FldRef.SetRange(FilterValue);
        ResultCount := RecRef.Count();
        RecRef.Close();
        exit(ResultCount);
    end;

    procedure GetFilterSafeText(var RecRef: RecordRef; FieldNo: Integer): Text
    var
        FldRef: FieldRef;
    begin
        if not RecRef.FieldExist(FieldNo) then
            exit('');

        FldRef := RecRef.Field(FieldNo);
        exit(Format(FldRef.Value(), 0, 9));
    end;

    procedure CountByDateRange(TableNo: Integer; FieldNo: Integer; FromDate: Date; ToDate: Date): Integer
    var
        RecRef: RecordRef;
        FldRef: FieldRef;
        ResultCount: Integer;
    begin
        RecRef.Open(TableNo);
        FldRef := RecRef.Field(FieldNo);
        FldRef.SetRange(FromDate, ToDate);
        ResultCount := RecRef.Count();
        RecRef.Close();
        exit(ResultCount);
    end;

    procedure CopyFieldFilter(var SourceRecRef: RecordRef; SourceFieldNo: Integer; var TargetRecRef: RecordRef; TargetFieldNo: Integer)
    var
        SourceFldRef: FieldRef;
        TargetFldRef: FieldRef;
        FieldValue: Variant;
    begin
        SourceFldRef := SourceRecRef.Field(SourceFieldNo);
        FieldValue := SourceFldRef.Value();
        TargetFldRef := TargetRecRef.Field(TargetFieldNo);
        TargetFldRef.SetRange(FieldValue);
    end;
}