table 70018 "CGR Dispatch Counter"
{
    DataClassification = SystemMetadata;

    fields
    {
        field(1; "Primary Key"; Code[10]) { }
        field(2; "Attempt Count"; Integer) { }
        field(3; "Delivered Count"; Integer) { }
        field(4; "Failure Count"; Integer) { }
    }

    keys
    {
        key(PK; "Primary Key") { Clustered = true; }
    }
}
