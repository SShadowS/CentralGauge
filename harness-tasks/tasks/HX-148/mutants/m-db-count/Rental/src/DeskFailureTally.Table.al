table 70269 "CGR Desk Failure Tally"
{
    DataClassification = SystemMetadata;

    fields
    {
        field(1; "Desk Code"; Code[10])
        {
        }
        field(2; Failures; Integer)
        {
        }
    }

    keys
    {
        key(PK; "Desk Code")
        {
            Clustered = true;
        }
    }
}
