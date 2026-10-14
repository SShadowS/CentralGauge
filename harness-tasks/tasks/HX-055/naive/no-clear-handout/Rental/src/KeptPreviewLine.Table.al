table 70224 "CGR Kept Preview Line"
{
    TableType = Temporary;
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Contract No."; Code[20]) { }
        field(2; "Line No."; Integer) { }
        field(3; Description; Text[100]) { }
        field(4; Quantity; Decimal) { }
        field(5; "Unit Price"; Decimal) { }
        field(6; Amount; Decimal) { }
    }

    keys
    {
        key(PK; "Contract No.", "Line No.") { Clustered = true; }
    }
}
