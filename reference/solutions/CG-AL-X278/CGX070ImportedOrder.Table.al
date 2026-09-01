table 70351 "CG X070 Imported Order"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Batch Code"; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Line No."; Integer) { DataClassification = CustomerContent; }
        field(3; "Customer No."; Code[20]) { DataClassification = CustomerContent; }
        field(4; Quantity; Decimal) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Batch Code", "Line No.") { Clustered = true; }
    }
}
