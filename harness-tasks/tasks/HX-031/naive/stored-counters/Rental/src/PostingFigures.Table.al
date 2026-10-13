table 70223 "CGR Posting Figures"
{
    DataClassification = SystemMetadata;

    fields
    {
        field(1; "Primary Key"; Code[10]) { }
        field(2; "Attempted Count"; Integer) { }
        field(3; "Posted Count"; Integer) { }
        field(4; "Posted Amount"; Decimal) { }
    }

    keys
    {
        key(PK; "Primary Key") { Clustered = true; }
    }
}
