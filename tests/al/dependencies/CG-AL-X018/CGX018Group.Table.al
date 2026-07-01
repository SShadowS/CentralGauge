table 69760 "CG X018 Group"
{
    DataClassification = SystemMetadata;

    fields
    {
        field(1; "Code"; Code[20]) { }
        field(2; "Totaling"; Text[100]) { }
    }

    keys
    {
        key(PK; "Code") { Clustered = true; }
    }
}
