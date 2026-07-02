table 69911 "CG X040 Log"
{
    DataClassification = SystemMetadata;
    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Batch Id"; Integer) { }
        field(3; "Phase"; Code[10]) { }
    }
    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }
}
