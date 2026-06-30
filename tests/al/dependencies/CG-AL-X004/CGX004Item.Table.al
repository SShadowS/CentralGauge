table 69630 "CG X004 Item"
{
    DataClassification = SystemMetadata;
    fields
    {
        field(1; "Entry No."; Integer) { }
        field(2; "Category"; Code[1]) { }
        field(3; "Tag"; Integer) { }
    }
    keys { key(PK; "Entry No.") { Clustered = true; } }
}
