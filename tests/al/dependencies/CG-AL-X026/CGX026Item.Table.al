table 69820 "CG X026 Item"
{
    DataClassification = SystemMetadata;
    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; "Category"; Code[20]) { }
        field(3; "Amount"; Integer) { }
    }
    keys { key(PK; "No.") { Clustered = true; } }
}
