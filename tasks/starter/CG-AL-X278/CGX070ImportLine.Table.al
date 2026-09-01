table 70350 "CG X070 Import Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Batch Code"; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Line No."; Integer) { DataClassification = CustomerContent; }
        field(3; "Customer No."; Code[20]) { DataClassification = CustomerContent; }
        field(4; Quantity; Decimal) { DataClassification = CustomerContent; }
        field(5; Status; Enum "CG X070 Import Status") { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Batch Code", "Line No.") { Clustered = true; }
    }
}
