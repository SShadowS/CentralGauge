table 69971 "CG X046 Archive"
{
    DataClassification = SystemMetadata;
    fields
    {
        field(1; "No."; Code[20]) { }
        field(10; Amount; Integer) { }
        field(20; Note; Text[50]) { }
    }
    keys { key(PK; "No.") { Clustered = true; } }
}
