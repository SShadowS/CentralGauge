table 69770 "CG X019 Doc"
{
    DataClassification = SystemMetadata;

    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; "Ref ID"; Guid) { }
        field(3; "Amount"; Integer) { }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
