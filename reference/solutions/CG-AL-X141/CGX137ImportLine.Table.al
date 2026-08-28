table 70970 "CG X137 Import Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { DataClassification = CustomerContent; }
        field(2; "Batch No."; Code[20]) { DataClassification = CustomerContent; }
        field(3; Amount; Integer) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }
}
