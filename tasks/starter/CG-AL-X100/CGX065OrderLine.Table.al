table 70200 "CG X065 Order Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { DataClassification = CustomerContent; }
        field(2; Category; Code[10]) { DataClassification = CustomerContent; }
        field(3; Quantity; Integer) { DataClassification = CustomerContent; }
        field(4; "Line Total"; Integer) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }
}
