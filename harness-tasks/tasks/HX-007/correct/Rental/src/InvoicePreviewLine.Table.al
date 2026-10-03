table 70210 "CGR Invoice Preview Line"
{
    TableType = Temporary;
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Line No."; Integer) { }
        field(2; "Contract No."; Code[20]) { }
        field(3; Description; Text[100]) { }
        field(4; Quantity; Decimal) { }
        field(5; "Unit Price"; Decimal) { }
        field(6; Amount; Decimal) { }
        field(7; "Branch Code"; Code[10]) { }
    }

    keys
    {
        key(PK; "Line No.") { Clustered = true; }
    }

    trigger OnInsert()
    var
        AmountRounding: Codeunit "CGR Amount Rounding";
    begin
        Amount := AmountRounding.RoundBranchAmount(Quantity * "Unit Price", "Branch Code");
    end;
}
