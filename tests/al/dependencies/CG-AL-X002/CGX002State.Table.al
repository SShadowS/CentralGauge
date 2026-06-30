table 69620 "CG X002 State"
{
    DataClassification = SystemMetadata;

    fields
    {
        field(1; "Primary Key"; Code[10]) { }
        field(2; "Done"; Boolean) { }
    }

    keys
    {
        key(PK; "Primary Key") { Clustered = true; }
    }
}
