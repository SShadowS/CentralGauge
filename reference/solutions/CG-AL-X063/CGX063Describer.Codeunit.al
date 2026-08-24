codeunit 71500 "CG X063 Describer"
{
    Access = Internal;

    procedure DescribeOf(TableNo: Integer; EntryNo: Integer): Text
    var
        RecRef: RecordRef;
        KeyRef: FieldRef;
        ValueRef: FieldRef;
        Result: Text;
    begin
        RecRef.Open(TableNo);

        KeyRef := RecRef.Field(1);
        KeyRef.SetRange(EntryNo);
        if RecRef.FindFirst() then
            // Field(2) raises unless the table actually has it, so guard first.
            if RecRef.FieldExist(2) then begin
                ValueRef := RecRef.Field(2);
                Result := Format(ValueRef.Value());
            end;

        RecRef.Close();
        exit(Result);
    end;
}
