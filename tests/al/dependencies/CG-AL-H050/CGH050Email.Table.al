table 69500 "CG H050 Email"
{
    DataClassification = SystemMetadata;

    fields
    {
        field(1; "Entry No."; Integer) { }
        field(2; "Address"; Text[80]) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }
}
