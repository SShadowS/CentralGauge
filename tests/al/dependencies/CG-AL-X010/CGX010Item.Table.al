table 69700 "CG X010 Item"
{
    DataClassification = SystemMetadata;
    fields
    {
        field(1; "Code"; Code[20]) { }
        field(2; "Value"; Integer) { }
    }
    keys { key(PK; "Code") { Clustered = true; } }
}
