table 70770 "CG X117 Sales Order"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Customer No."; Code[20]) { DataClassification = CustomerContent; }
        field(3; "Customer Name"; Text[100]) { DataClassification = CustomerContent; }
        field(4; "Order Date"; Date) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
