table 69890 "CG X037 Journal"
{
    DataClassification = SystemMetadata;
    fields
    {
        field(1; "Batch Id"; Integer) { }
        field(2; "Step"; Integer) { }
        field(3; "Amount"; Integer) { }
    }
    keys
    {
        key(PK; "Batch Id", "Step") { Clustered = true; }
    }
}
