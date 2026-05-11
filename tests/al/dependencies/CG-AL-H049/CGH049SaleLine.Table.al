table 69490 "CG H049 Sale Line"
{
    DataClassification = SystemMetadata;

    fields
    {
        field(1; "Entry No."; Integer) { }
        field(2; "Doc No."; Code[20]) { }
        field(3; "Amount"; Decimal) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(ByDoc; "Doc No.") { IncludedFields = "Amount"; }
    }
}
