table 70140 "CGR Yard Finding"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Vehicle No."; Code[20]) { }
        field(3; Note; Text[100]) { }
        field(4; Closed; Boolean) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }
}
