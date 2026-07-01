table 69650 "CG X005 Item"
{
    DataClassification = SystemMetadata;
    fields
    {
        field(1; "Code"; Code[10]) { }
        field(2; "Value"; Integer) { }
        field(3; "Flag"; Boolean) { }
    }
    keys { key(PK; "Code") { Clustered = true; } }
}
