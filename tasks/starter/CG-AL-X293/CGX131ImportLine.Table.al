table 70910 "CG X131 Import Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Batch Code"; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Line No."; Integer) { DataClassification = CustomerContent; }
        field(3; "Item No."; Code[20]) { DataClassification = CustomerContent; }
        field(4; Quantity; Decimal) { DataClassification = CustomerContent; }
        field(5; "Unit Cost"; Decimal) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Batch Code", "Line No.") { Clustered = true; }
    }
}
