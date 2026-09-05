codeunit 70034 "CG SACF Demo"
{
    Access = Public;

    procedure GetParentTotalViaRef(ParentNo: Code[20]): Decimal
    var
        Parent: Record "CG SACF Parent";
        RecRef: RecordRef;
        TotalRef: FieldRef;
        NoRef: FieldRef;
        TotalAmount: Decimal;
    begin
        RecRef.Open(Database::"CG SACF Parent");
        RecRef.SetAutoCalcFields(Parent.FieldNo("Total Amount"));

        NoRef := RecRef.Field(Parent.FieldNo("No."));
        NoRef.SetRange(ParentNo);

        if not RecRef.FindFirst() then
            Error('Parent %1 was not found.', ParentNo);

        TotalRef := RecRef.Field(Parent.FieldNo("Total Amount"));
        TotalAmount := TotalRef.Value();

        exit(TotalAmount);
    end;
}