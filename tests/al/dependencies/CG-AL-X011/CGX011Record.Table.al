table 69710 "CG X011 Record"
{
    DataClassification = SystemMetadata;
    fields
    {
        field(1; "Code"; Code[20]) { }
        field(2; "A"; Integer) { }
        field(3; "B"; Integer) { }
        field(4; "C"; Integer) { }
    }
    keys { key(PK; "Code") { Clustered = true; } }
}
