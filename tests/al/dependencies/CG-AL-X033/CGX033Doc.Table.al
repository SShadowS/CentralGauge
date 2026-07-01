table 69850 "CG X033 Doc"
{
    DataClassification = SystemMetadata;
    fields
    {
        field(1; "No."; Code[20]) { }
        field(10; "Net Amount"; Decimal) { }
        field(20; "Freight Amount"; Decimal) { }
        field(30; "Note"; Text[50]) { }
    }
    keys { key(PK; "No.") { Clustered = true; } }
}
