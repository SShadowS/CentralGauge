table 70641 "CG X104 Price List Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "List Code"; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Line No."; Integer) { DataClassification = CustomerContent; }
        field(3; "Item No."; Code[20]) { DataClassification = CustomerContent; }
        field(4; "Unit Price"; Decimal) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "List Code", "Line No.") { Clustered = true; }
    }
}
