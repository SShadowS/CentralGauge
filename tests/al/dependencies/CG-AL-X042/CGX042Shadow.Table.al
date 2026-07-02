table 69941 "CG X042 Shadow"
{
    DataClassification = SystemMetadata;
    fields
    {
        field(1; "Batch Id"; Integer) { }
        field(2; "Step"; Integer) { }
        field(3; "Checksum"; Integer) { }
    }
    keys
    {
        key(PK; "Batch Id", "Step") { Clustered = true; }
    }
}
